import { test } from '@japa/runner'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DownloadEpisodesTask } from '../../app/tasks/download_episodes_task.js'

const MB = 1024 * 1024

/** 25 MB: with 4 workers it is split in 2 segments (16 MB and 9 MB) */
const FILE = randomBytes(25 * MB)

/** Private members of the task used by these tests */
const task = DownloadEpisodesTask as any

interface ServerOptions {
  /** Answer 200 with the whole file instead of 206 */
  ignoreRange?: boolean
  /** Close the connection halfway through the first segment that does not start at 0 */
  truncateOnce?: boolean
  /** Answer the first segment request with a 429 and this Retry-After header */
  rateLimitOnce?: string
  /** File served, FILE by default */
  file?: Buffer
  /** Content-Range total written by the server, the file size by default */
  rangeTotal?: string
}

async function startServer(options: ServerOptions = {}) {
  let truncated = false
  let rateLimited = false
  const ranges: string[] = []
  const encodings: string[] = []
  const file = options.file ?? FILE
  const server: Server = createServer((req, res) => {
    encodings.push(String(req.headers['accept-encoding']))
    const match = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
    if (options.ignoreRange || !match) {
      res.writeHead(200, { 'Content-Length': file.length })
      res.end(file)
      return
    }
    ranges.push(match[0])
    if (options.rateLimitOnce !== undefined && !rateLimited) {
      rateLimited = true
      res.writeHead(429, { 'Retry-After': options.rateLimitOnce })
      res.end('Too Many Requests')
      return
    }
    const start = Number(match[1])
    const end = Number(match[2])
    res.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${options.rangeTotal ?? file.length}`,
    })
    if (options.truncateOnce && start > 0 && !truncated) {
      truncated = true
      res.write(file.subarray(start, start + Math.floor((end - start + 1) / 2)), () =>
        res.destroy()
      )
      return
    }
    res.end(file.subarray(start, end + 1))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, ranges, encodings, url: `http://127.0.0.1:${port}/episode.mp4` }
}

/** Calls the private downloadSegments with a queue that only records progress */
async function download(url: string, outputPath: string, workers = 4, file = FILE) {
  const progress: number[] = []
  const queue = { updateProgress: (_id: string, value: number) => progress.push(value) }
  const completed = await task.downloadSegments(
    url,
    outputPath,
    file.length,
    workers,
    queue,
    'test-item'
  )
  return { completed, progress }
}

test.group('DownloadEpisodesTask segment split', () => {
  /** Segment sizes in MB, rounded */
  const sizes = (fileSize: number, workers: number) =>
    task
      .splitIntoSegments(fileSize, workers)
      .map((s: { start: number; end: number }) => Math.round((s.end - s.start + 1) / MB))

  test('uses one segment per worker up to 100 MB each', ({ assert }) => {
    assert.deepEqual(sizes(300 * MB, 4), [75, 75, 75, 75])
    assert.deepEqual(sizes(400 * MB, 4), [100, 100, 100, 100])
  })

  test('splits bigger files in segments of 100 MB', ({ assert }) => {
    assert.deepEqual(sizes(450 * MB, 4), [100, 100, 100, 100, 50])
    assert.lengthOf(sizes(2000 * MB, 4), 20)
  })

  test('never makes segments smaller than 16 MB, except the last one', ({ assert }) => {
    assert.deepEqual(sizes(10 * MB, 4), [10])
    assert.deepEqual(sizes(20 * MB, 4), [16, 4])
  })

  test('covers the whole file without gaps', ({ assert }) => {
    const fileSize = 1234 * MB + 567
    const segments = task.splitIntoSegments(fileSize, 3)
    assert.equal(segments[0].start, 0)
    assert.equal(segments.at(-1).end, fileSize - 1)
    for (let i = 1; i < segments.length; i++) {
      assert.equal(segments[i].start, segments[i - 1].end + 1)
    }
  })
})

test.group('DownloadEpisodesTask rate limit delay', () => {
  test('uses Retry-After in seconds, capped at 60 seconds', ({ assert }) => {
    assert.equal(task.rateLimitDelay('3', 1), 3000)
    assert.equal(task.rateLimitDelay('3600', 1), 60_000)
  })

  test('uses Retry-After as an HTTP date', ({ assert }) => {
    const delay = task.rateLimitDelay(new Date(Date.now() + 10_000).toUTCString(), 1)
    assert.isAbove(delay, 8000)
    assert.isAtMost(delay, 10_000)
  })

  test('grows with the attempt when Retry-After is missing or invalid', ({ assert }) => {
    assert.equal(task.rateLimitDelay(undefined, 1), 5000)
    assert.equal(task.rateLimitDelay('soon', 2), 10_000)
  })
})

test.group('DownloadEpisodesTask segmented download', (group) => {
  let tempDir: string
  group.each.setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-segments-'))
    return () => fs.rm(tempDir, { recursive: true, force: true })
  })

  test('downloads every segment into an identical file', async ({ assert }) => {
    const { server, ranges, encodings, url } = await startServer()
    try {
      const outputPath = path.join(tempDir, 'out.mp4.tmp')
      const { completed, progress } = await download(url, outputPath)
      assert.isTrue(completed)
      const downloaded = await fs.readFile(outputPath)
      assert.isTrue(downloaded.equals(FILE))
      assert.lengthOf(ranges, 2)
      assert.isTrue(
        encodings.every((encoding) => encoding === 'identity'),
        'segments are requested uncompressed'
      )
      assert.equal(progress.at(-1), 100)
    } finally {
      server.close()
    }
  }).timeout(20000)

  test('retries a segment that arrives incomplete', async ({ assert }) => {
    const { server, url } = await startServer({ truncateOnce: true })
    try {
      const outputPath = path.join(tempDir, 'out.mp4.tmp')
      const { completed } = await download(url, outputPath)
      assert.isTrue(completed)
      const downloaded = await fs.readFile(outputPath)
      assert.isTrue(downloaded.equals(FILE))
    } finally {
      server.close()
    }
  }).timeout(20000)

  test('waits and retries a segment answered with 429', async ({ assert }) => {
    const { server, url } = await startServer({ rateLimitOnce: '1' })
    try {
      const outputPath = path.join(tempDir, 'out.mp4.tmp')
      const startedAt = Date.now()
      const { completed } = await download(url, outputPath)
      assert.isTrue(completed)
      assert.isAtLeast(Date.now() - startedAt, 1000)
      const downloaded = await fs.readFile(outputPath)
      assert.isTrue(downloaded.equals(FILE))
    } finally {
      server.close()
    }
  }).timeout(20000)

  test('accepts a 200 when the only segment is the whole file', async ({ assert }) => {
    const small = randomBytes(10 * MB)
    const { server, url } = await startServer({ ignoreRange: true, file: small })
    try {
      const outputPath = path.join(tempDir, 'out.mp4.tmp')
      const { completed } = await download(url, outputPath, 4, small)
      assert.isTrue(completed)
      const downloaded = await fs.readFile(outputPath)
      assert.isTrue(downloaded.equals(small))
    } finally {
      server.close()
    }
  }).timeout(20000)

  test('accepts a Content-Range with an unknown total', async ({ assert }) => {
    const { server, url } = await startServer({ rangeTotal: '*' })
    try {
      const outputPath = path.join(tempDir, 'out.mp4.tmp')
      const { completed } = await download(url, outputPath)
      assert.isTrue(completed)
      const downloaded = await fs.readFile(outputPath)
      assert.isTrue(downloaded.equals(FILE))
    } finally {
      server.close()
    }
  }).timeout(20000)

  test('fails when the server ignores the Range header', async ({ assert }) => {
    const { server, url } = await startServer({ ignoreRange: true })
    try {
      await assert.rejects(
        () => download(url, path.join(tempDir, 'out.mp4.tmp')),
        /non supporta i download a segmenti/
      )
    } finally {
      server.close()
    }
  }).timeout(20000)
})

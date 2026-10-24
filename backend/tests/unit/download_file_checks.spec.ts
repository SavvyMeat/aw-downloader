import { test } from '@japa/runner'
import { createServer, type OutgoingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DownloadEpisodesTask } from '../../app/tasks/download_episodes_task.js'
import { SpeedMeter } from '../../app/helpers/speed_meter.js'

const MB = 1024 * 1024

/** Private members of the task used by these tests */
const task = DownloadEpisodesTask as any

/**
 * Runs getFileInfo against a local server that answers every request with these headers
 */
async function fileInfo(headers: OutgoingHttpHeaders, pathname = '/episode.mp4') {
  const server = createServer((_req, res) => {
    res.writeHead(200, headers)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await task.getFileInfo(`http://127.0.0.1:${port}${pathname}`)
  } finally {
    server.close()
  }
}

const VIDEO = { 'Content-Type': 'video/mp4', 'Content-Length': 300 * MB }

test.group('DownloadEpisodesTask file checks', () => {
  test('accepts a video file', async ({ assert }) => {
    assert.deepEqual(await fileInfo(VIDEO), { extension: 'mp4', size: 300 * MB })
  })

  test('accepts video/*, application/octet-stream and application/mp4', async ({ assert }) => {
    for (const type of [
      'video/x-matroska',
      'VIDEO/MP4; charset=binary',
      'application/octet-stream',
      'application/mp4',
    ]) {
      const info = await fileInfo({ ...VIDEO, 'Content-Type': type })
      assert.equal(info.size, 300 * MB, type)
    }
  })

  test('rejects other Content-Types', async ({ assert }) => {
    for (const type of ['text/html; charset=utf-8', 'application/json', 'application/zip']) {
      await assert.rejects(
        () => fileInfo({ ...VIDEO, 'Content-Type': type }),
        /Content-Type non ammesso/
      )
    }
  })

  test('fails with a real error when Content-Type is missing', async ({ assert }) => {
    const error = await fileInfo({ 'Content-Length': 300 * MB }).catch((e) => e)
    assert.match(error.message, /Content-Type assente/)
    assert.equal(error.constructor.name, 'Error', 'not a silent rejection')
  })

  test('rejects files smaller than 5 MB', async ({ assert }) => {
    await assert.rejects(
      () => fileInfo({ ...VIDEO, 'Content-Length': 5703 }),
      /file troppo piccolo \(5\.6 KB, minimo 5\.0 MB\)/
    )
    const info = await fileInfo({ ...VIDEO, 'Content-Length': 5 * MB })
    assert.equal(info.size, 5 * MB)
  })

  test('rejects extensions that are not video', async ({ assert }) => {
    await assert.rejects(() => fileInfo(VIDEO, '/setup.exe'), /estensione non ammessa: \.exe/)
    await assert.rejects(() => fileInfo(VIDEO, '/download'), /estensione non ammessa: assente/)
  })

  test('takes the extension from Content-Disposition before the URL', async ({ assert }) => {
    const info = await fileInfo(
      { ...VIDEO, 'Content-Disposition': 'attachment; filename="Episodio 01.MKV"' },
      '/file.mp4'
    )
    assert.equal(info.extension, 'mkv')
    await assert.rejects(
      () => fileInfo({ ...VIDEO, 'Content-Disposition': 'attachment; filename="x.zip"' }),
      /estensione non ammessa: \.zip/
    )
  })
})

test.group('SpeedMeter', () => {
  test('measures the speed since the start while shorter than the window', ({ assert }) => {
    const meter = new SpeedMeter(5000, 0)
    meter.add(2 * MB)
    assert.equal(meter.speed(2000), MB)
  })

  test('only counts the bytes of the last window', ({ assert }) => {
    const meter = new SpeedMeter(5000, 0)
    // 10 MB/s for 10 seconds, then 1 MB/s
    for (let second = 1; second <= 10; second++) {
      meter.add(10 * MB)
      meter.speed(second * 1000)
    }
    for (let second = 11; second <= 16; second++) {
      meter.add(MB)
      meter.speed(second * 1000)
    }
    assert.equal(meter.speed(16000), MB)
  })

  test('drops to 0 when no data arrives', ({ assert }) => {
    const meter = new SpeedMeter(5000, 0)
    for (let second = 1; second <= 5; second++) {
      meter.add(MB)
      meter.speed(second * 1000)
    }
    for (let second = 6; second <= 10; second++) {
      meter.speed(second * 1000)
    }
    assert.equal(meter.speed(10000), 0)
  })
})

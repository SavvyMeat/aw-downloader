import { test } from '@japa/runner'
import { createServer, type OutgoingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import emitter from '@adonisjs/core/services/emitter'
import DownloadErrorEvent from '#events/download_error_event'
import { DownloadEpisodesTask } from '../../app/tasks/download_episodes_task.js'
import { DownloadQueue, getDownloadQueue } from '#services/download_queue'

const MB = 1024 * 1024

/** Private members of the task used by these tests */
const task = DownloadEpisodesTask as any

/** Local server answering every request with this status and these headers, no body */
async function startServer(status: number, headers: OutgoingHttpHeaders) {
  const server = createServer((_req, res) => {
    res.writeHead(status, headers)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/episode.mp4` }
}

const episodeParams = (downloadUrl: string) => ({
  mediaType: 'episode' as const,
  episodeId: 1,
  seriesId: 1,
  seasonId: 1,
  seriesTitle: 'SAKAMOTO DAYS',
  seasonNumber: 1,
  episodeNumber: 5,
  episodeTitle: 'Source of Strength',
  downloadUrl,
})

test.group('DownloadEpisodesTask execute', (group) => {
  let failures: Array<{ id: string; error: string }>

  group.each.setup(() => {
    // No database in unit tests: fixed worker count, and failures recorded instead of queued
    const getMaxWorkers = task.getMaxWorkers
    task.getMaxWorkers = async () => 4
    const queue = getDownloadQueue()
    const failItem = queue.failItem
    failures = []
    queue.failItem = (id: string, error: string) => {
      failures.push({ id, error })
    }
    return () => {
      task.getMaxWorkers = getMaxWorkers
      queue.failItem = failItem
      emitter.restore()
    }
  })

  test('a rejected file is only a warning: no error notification', async ({ assert }) => {
    const events = emitter.fake([DownloadErrorEvent])
    const { server, url } = await startServer(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': 5703,
    })
    try {
      await DownloadEpisodesTask.execute(episodeParams(url), 'rejected-item')
      assert.lengthOf(failures, 1)
      assert.match(failures[0].error, /file troppo piccolo/)
      events.assertNotEmitted(DownloadErrorEvent)
    } finally {
      server.close()
    }
  })

  test('other errors still send the error notification', async ({ assert }) => {
    const events = emitter.fake([DownloadErrorEvent])
    const { server, url } = await startServer(200, { 'Content-Length': 300 * MB })
    try {
      await DownloadEpisodesTask.execute(episodeParams(url), 'no-type-item')
      assert.lengthOf(failures, 1)
      events.assertEmitted(DownloadErrorEvent)
    } finally {
      server.close()
    }
  })

  test('a download cancelled while failing sends no notification', async ({ assert }) => {
    const events = emitter.fake([DownloadErrorEvent])
    const { server, url } = await startServer(500, {})
    try {
      DownloadEpisodesTask.cancelDownload('cancelled-item')
      // Cancelled after the start check: the HEAD request then fails
      const isCancelled = task.isCancelled
      let checks = 0
      task.isCancelled = (id: string) => (++checks === 1 ? false : isCancelled.call(task, id))
      try {
        await DownloadEpisodesTask.execute(episodeParams(url), 'cancelled-item')
      } finally {
        task.isCancelled = isCancelled
      }
      assert.lengthOf(failures, 0)
      events.assertNotEmitted(DownloadErrorEvent)
      assert.isFalse(task.isCancelled('cancelled-item'), 'cancellation is cleared')
    } finally {
      server.close()
    }
  })
})

test.group('DownloadQueue cancel', () => {
  test('refuses to cancel an item that is being imported', async ({ assert }) => {
    const queue = new DownloadQueue()
    const item = {
      id: 'importing-item',
      ...episodeParams('http://example.invalid/episode.mp4'),
      status: 'downloading' as const,
      phase: 'importing' as const,
      progress: 100,
      addedAt: new Date(),
    }
    ;(queue as any).activeDownloads.set(item.id, item)

    assert.isFalse(await queue.cancelDownload(item.id))
    assert.equal(item.status, 'downloading')
    assert.isTrue(queue.getActiveDownloads().includes(item))
  })
})

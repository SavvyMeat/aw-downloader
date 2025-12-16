import type { HttpContext } from '@adonisjs/core/http'
import { getDownloadQueue } from '#services/download_queue'

export default class DownloadQueueController {
  /**
   * Get all queue items
   */
  async index({ response }: HttpContext) {
    const queue = getDownloadQueue()
    const items = queue.getAllItems()
    const config = await queue.getConfig()

    return response.json({
      items,
      config,
    })
  }

  /**
   * Get queue configuration
   */
  async config({ response }: HttpContext) {
    const queue = getDownloadQueue()
    const config = await queue.getConfig()

    return response.json(config)
  }

  /**
   * Add item to queue
   */
  async store({ request, response }: HttpContext) {
    const data = request.only([
      'seriesId',
      'seasonId',
      'episodeId',
      'seriesTitle',
      'seasonNumber',
      'episodeNumber',
      'episodeTitle',
      'downloadUrl',
    ])

    // Validate required fields
    if (
      !data.seriesId ||
      !data.seasonId ||
      !data.episodeId ||
      !data.seriesTitle ||
      data.seasonNumber === undefined ||
      !data.episodeNumber ||
      !data.episodeTitle ||
      !data.downloadUrl
    ) {
      return response.badRequest({ message: 'Missing required fields' })
    }

    try {
      const queue = getDownloadQueue()
      const id = queue.addToQueue(data)

      return response.json({
        message: 'Item added to queue',
        id,
      })
    } catch (error) {
      return response.badRequest({
        message: error instanceof Error ? error.message : 'Failed to add item to queue',
      })
    }
  }

  /**
   * Remove item from queue or cancel active download
   */
  async destroy({ params, response }: HttpContext) {
    const queue = getDownloadQueue()
    const removed = await queue.cancelDownload(params.id)

    if (!removed) {
      return response.notFound({
        message: 'Item not found or cannot be removed',
      })
    }

    return response.json({
      message: 'Item removed from queue',
    })
  }

  /**
   * Clear completed items
   */
  async clearCompleted({ response }: HttpContext) {
    const queue = getDownloadQueue()
    queue.clearCompleted()

    return response.json({
      message: 'Completed items cleared',
    })
  }

  /**
   * Stop all pending and active downloads
   */
  async stopAll({ response }: HttpContext) {
    const queue = getDownloadQueue()
    const items = queue.getAllItems()
    
    // Stop all pending and downloading items
    const itemsToStop = items.filter(
      (item) => item.status === 'pending' || item.status === 'downloading'
    )

    for (const item of itemsToStop) {
      await queue.cancelDownload(item.id)
    }

    return response.json({
      message: `Stopped ${itemsToStop.length} downloads`,
      count: itemsToStop.length,
    })
  }
}

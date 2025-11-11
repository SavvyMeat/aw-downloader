import { BaseTask } from './base_task.js'
import Episode from '#models/episode'
import { getDownloadQueue } from '#services/download_queue'
import { AnimeworldService } from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import { getSonarrService, type SonarrWantedRecord } from '#services/sonarr_service'

export class FetchWantedTask extends BaseTask {
  id = 'fetch_wanted'
  name = 'Recupero Lista Wanted'
  description = 'Recupera la lista degli episodi mancanti da Sonarr'
  defaultIntervalMinutes = 30 // 30 minuti

  private wantedEpisodes: SonarrWantedRecord[] = []
  private animeworldService: AnimeworldService
  private sonarrService = getSonarrService()

  constructor(intervalMinutes?: number) {
    super(intervalMinutes)
    this.animeworldService = new AnimeworldService()
  }

  async execute(): Promise<void> {
    // Initialize Sonarr service
    await this.sonarrService.initialize()

    // Fetch wanted/missing episodes from Sonarr
    const response = await this.sonarrService.getWantedMissingEpisodes(100, 'airDateUtc', 'descending')

    // Filter out episodes without valid seriesId
    this.wantedEpisodes = response.records.filter(
      (ep) => ep.seriesId && ep.seasonNumber !== undefined && ep.episodeNumber !== undefined
    )

    logger.info('FetchWanted', `Found ${this.wantedEpisodes.length} wanted/missing episodes`)

    // Log some details
    const monitoredCount = this.wantedEpisodes.filter((ep) => ep.monitored).length
    logger.info('FetchWanted', `Monitored: ${monitoredCount}, Total in Sonarr: ${response.totalRecords}`)

    // Group by series for summary
    const bySeries = this.wantedEpisodes.reduce(
      (acc, ep) => {
        const seriesKey = `Series-${ep.seriesId}`
        if (!acc[seriesKey]) {
          acc[seriesKey] = 0
        }
        acc[seriesKey]++
        return acc
      },
      {} as Record<string, number>
    )

    logger.debug('FetchWanted', 'Missing episodes by series', bySeries)

    // Add missing episodes to download queue
    await this.addToDownloadQueue()
  }

  /**
   * Add missing episodes to download queue
   */
  private async addToDownloadQueue(): Promise<void> {
    const queue = getDownloadQueue()
    let addedCount = 0
    let skippedCount = 0

    for (const wantedEp of this.wantedEpisodes) {
      // Only add monitored episodes
      if (!wantedEp.monitored) {
        continue
      }

      try {
        // Find the episode in database using Sonarr episode ID
        const episode = await Episode.query()
          .where('sonarr_id', wantedEp.id)
          .preload('series')
          .preload('season')
          .first()

        if (!episode) {
          logger.warning('FetchWanted', `Episode not found in database: Series ${wantedEp.seriesId} S${wantedEp.seasonNumber}E${wantedEp.episodeNumber}`)
          continue
        }

        // Check if already in queue
        const existingItems = queue.getAllItems()
        const alreadyInQueue = existingItems.some(
          (item) =>
            item.episodeId === episode.id &&
            (item.status === 'pending' || item.status === 'downloading')
        )

        if (alreadyInQueue) {
          skippedCount++
          continue
        }

        // Get download URL from AnimeWorld
        const downloadUrl = await this.findDownloadUrl(episode)
        
        if (!downloadUrl) {
          logger.warning('FetchWanted', `No download URL found for: ${episode.series.title} S${episode.season.seasonNumber}E${episode.episodeNumber}`)
          continue
        }

        // Add to queue
        const queueItemId = queue.addToQueue({
          seriesId: episode.seriesId,
          seasonId: episode.seasonId,
          episodeId: episode.id,
          seriesTitle: episode.series.title,
          seasonNumber: episode.season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title,
          downloadUrl: downloadUrl,
        })

        addedCount++
        logger.success('FetchWanted', `Added to queue: ${episode.series.title} S${episode.season.seasonNumber}E${episode.episodeNumber}`, { queueItemId })
      } catch (error) {
        logger.error('FetchWanted', 'Error adding episode to queue', error)
      }
    }

    logger.info('FetchWanted', `Added ${addedCount} episodes to download queue (${skippedCount} already in queue)`)
  }

  /**
   * Find download URL for an episode using AnimeWorld
   */
  private async findDownloadUrl(episode: Episode): Promise<string | null> {
    try {
      // Check if season has download URLs
      if (!episode.season.downloadUrls || episode.season.downloadUrls.length === 0) {
        logger.warning('FetchWanted', `No anime identifiers for episode ${episode.id}`)
        return null
      }

      // downloadUrls contains anime identifiers (slugs after /play/)
      const downloadUrls = episode.season.downloadUrls

      // Pass all identifiers to handle multi-part series
      logger.debug('FetchWanted', `Searching for episode ${episode.episodeNumber} in ${downloadUrls.length} part(s)`)

      const downloadLink = await this.animeworldService.findEpisodeDownloadLink(
        downloadUrls,
        episode.episodeNumber
      )

      if (downloadLink) {
        logger.success('FetchWanted', `Found download link for ${episode.series.title} S${episode.season.seasonNumber}E${episode.episodeNumber}`, { downloadLink })
      }

      return downloadLink
    } catch (error) {
      logger.error('FetchWanted', `Error finding download URL for episode ${episode.id}`, error)
      return null
    }
  }

  /**
   * Get current wanted episodes list
   */
  getWantedEpisodes(): SonarrWantedRecord[] {
    return this.wantedEpisodes
  }

  /**
   * Get wanted episodes count
   */
  getWantedCount(): number {
    return this.wantedEpisodes.length
  }

  /**
   * Get monitored wanted episodes count
   */
  getMonitoredCount(): number {
    return this.wantedEpisodes.filter((ep) => ep.monitored).length
  }
}

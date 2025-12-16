import { BaseTask } from './base_task.js'
import Season from '#models/season'
import Config from '#models/config'
import { getDownloadQueue } from '#services/download_queue'
import { AnimeworldService } from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import { getSonarrService, type SonarrWantedRecord } from '#services/sonarr_service'
import Series from '#models/series'

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

    // Check if we should filter only anime series
    const filterAnimeOnly = (await Config.get<boolean>('sonarr_filter_anime_only')) ?? true

    // Get tag filtering configuration
    const tagsMode = await Config.get<string>('sonarr_tags_mode')
    const tagsConfig = await Config.get<Array<{ value: string; label: string }>>('sonarr_tags')
    const tagIds = tagsConfig?.map((tag) => parseInt(tag.value)) || []

    // Fetch wanted/missing episodes from Sonarr
    const response = await this.sonarrService.getWantedMissingEpisodes(
      100,
      'airDateUtc',
      'ascending'
    )

    // Filter out episodes without valid seriesId
    this.wantedEpisodes = response.records
      .filter(
        (ep) => ep.seriesId && ep.seasonNumber !== undefined && ep.episodeNumber !== undefined
      )
      .filter((ep) => !filterAnimeOnly || ep.series?.seriesType === 'anime')
      .filter((ep) => {
        if (!tagsMode || tagIds.length === 0) {
          return true
        }
        const seriesTags = ep.series.tags || []
        if (tagsMode === 'blacklist') {
          return !tagIds.some((tagId) => seriesTags.includes(tagId))
        } else if (tagsMode === 'whitelist') {
          return tagIds.some((tagId) => seriesTags.includes(tagId))
        }
        return true
      })

    logger.info('FetchWanted', `Found ${this.wantedEpisodes.length} wanted/missing episodes`)

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
        const series = await Series.query()
          .preload('seasons')
          .where('sonarr_id', wantedEp.seriesId)
          .first()
        const season = series?.seasons.find((s) => series.absolute ? s.seasonNumber === 1 : s.seasonNumber === wantedEp.seasonNumber)

        if (!series || !season) {
          logger.warning(
            'FetchWanted',
            `Series ${wantedEp.series.title} Season ${wantedEp.seasonNumber} not found in database`
          )
          continue
        }

        // Check if already in queue
        const existingItems = queue.getAllItems()
        const alreadyInQueue = existingItems.some(
          (item) =>
            item.episodeId === wantedEp.id &&
            (item.status === 'pending' || item.status === 'downloading')
        )

        if (alreadyInQueue) {
          skippedCount++
          continue
        }

        // Get download URL from AnimeWorld
        const downloadUrl = await this.findDownloadUrl(series, season, wantedEp)

        if (!downloadUrl) {
          logger.warning(
            'FetchWanted',
            `No download URL found for: ${wantedEp.series.title} S${wantedEp.seasonNumber}E${wantedEp.episodeNumber}`
          )
          continue
        }

        // Add to queue
        const queueItemId = queue.addToQueue({
          seriesId: series.id,
          seasonId: season.id,
          episodeId: wantedEp.id,
          seriesTitle: wantedEp.series.title,
          seasonNumber: wantedEp.seasonNumber,
          episodeNumber: wantedEp.episodeNumber,
          episodeTitle: wantedEp.title,
          downloadUrl: downloadUrl,
        })

        addedCount++
        logger.success(
          'FetchWanted',
          `Added to queue: ${wantedEp.series.title} S${wantedEp.seasonNumber}E${wantedEp.episodeNumber}`,
          { queueItemId }
        )
      } catch (error) {
        logger.error('FetchWanted', 'Error adding episode to queue', error.message)
      }
    }

    logger.info(
      'FetchWanted',
      `Added ${addedCount} episodes to download queue (${skippedCount} already in queue)`
    )
  }

  /**
   * Find download URL for an episode using AnimeWorld
   */
  private async findDownloadUrl(
    serie: Series,
    season: Season,
    episode: SonarrWantedRecord
  ): Promise<string | null> {
    try {

      if (!season.downloadUrls || season.downloadUrls.length === 0) {
        logger.warning('FetchWanted', `No anime identifiers for episode ${episode.id}`)
        return null
      }

      const episodeNumberToSearch = serie.absolute
        ? episode.absoluteEpisodeNumber
        : episode.episodeNumber

      if (!episodeNumberToSearch) {
        logger.warning(
          'FetchWanted',
          `Cannot determine episode number to search for episode ${episode.id}`
        )
        return null
      }

      // Pass all identifiers to handle multi-part series
      logger.debug(
        'FetchWanted',
        `Searching for episode ${episodeNumberToSearch} in ${season.downloadUrls.length} part(s)`
      )

      const downloadLink = await this.animeworldService.findEpisodeDownloadLink(
        season.downloadUrls,
        episodeNumberToSearch
      )

      if (downloadLink) {
        logger.success(
          'FetchWanted',
          `Found download link for ${episode.series.title} S${episode.seasonNumber}E${episode.episodeNumber}`
        )
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

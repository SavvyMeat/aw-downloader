import { BaseTask } from './base_task.js'
import Season from '#models/season'
import Config from '#models/config'
import { getDownloadQueue } from '#services/download_queue'
import { AnimeworldService } from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import { getSonarrService, type SonarrWantedRecord } from '#services/sonarr_service'
import { MetadataSyncService } from '#services/metadata_sync_service'
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

    // Fetch wanted/missing episodes from Sonarr (all pages)
    this.wantedEpisodes = []
    let currentPage = 1
    let totalRecords = 0
    const pageSize = 100

    do {
      const response = await this.sonarrService.getWantedMissingEpisodes(
        pageSize,
        'airDateUtc',
        'ascending',
        currentPage
      )

      totalRecords = response.totalRecords

      // Filter and add episodes from current page
      const filteredEpisodes = response.records
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

      this.wantedEpisodes.push(...filteredEpisodes)

      currentPage++
    } while ((currentPage - 1) * pageSize < totalRecords)

    logger.info('FetchWanted', `Trovati ${this.wantedEpisodes.length} episodi mancanti`)

    // Ensure all series exist in local database
    await this.syncWantedSeriesMetadata()

    // Add missing episodes to download queue
    await this.addToDownloadQueue()
  }

  private async syncWantedSeriesMetadata(): Promise<void> {
    // Check if series exist in database and sync if needed
    const uniqueSeriesIds = [...new Set(this.wantedEpisodes.map(ep => ep.seriesId))]
    
    // Find which series are missing from database in a single query
    const existingSeries = await Series.query()
      .whereIn('sonarrId', uniqueSeriesIds)
      .select('id')
      .pojo()
    const existingIds = existingSeries.map((s) => (s as { id: number }).id);
    const missingSeriesIds = uniqueSeriesIds.filter(id => !existingIds.includes(id))

    const metadataSyncService = new MetadataSyncService()

    // Sync only missing series
    for (const sonarrId of missingSeriesIds) {
      await metadataSyncService.syncSeries(sonarrId)
    }
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
            `Serie "${wantedEp.series.title}" Stagione ${wantedEp.seasonNumber} non trovata nel database`
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
            `Link di download non trovato per: ${wantedEp.series.title} S${wantedEp.seasonNumber}E${wantedEp.episodeNumber}`
          )
          continue
        }

        // Add to queue
        queue.addToQueue({
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
        logger.info(
          'FetchWanted',
          `Aggiunto alla coda: ${wantedEp.series.title} S${wantedEp.seasonNumber}E${wantedEp.episodeNumber}`
        )
      } catch (error) {
        logger.error('FetchWanted', 'Errore durante l\'aggiunta dell\'episodio alla coda', error)
      }
    }

    logger.info(
      'FetchWanted',
      `Aggiunti ${addedCount} episodi alla coda (${skippedCount} già presenti)`
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
        logger.warning('FetchWanted', `Nessun identificatore anime disponibile per l\'episodio`)
        return null
      }

      const episodeNumberToSearch = serie.absolute
        ? episode.absoluteEpisodeNumber
        : episode.episodeNumber

      if (!episodeNumberToSearch) {
        logger.warning(
          'FetchWanted',
          `Impossibile determinare il numero dell\'episodio da cercare`
        )
        return null
      }

      // Pass all identifiers to handle multi-part series
      const downloadLink = await this.animeworldService.findEpisodeDownloadLink(
        season.downloadUrls,
        episodeNumberToSearch
      )

      return downloadLink
    } catch (error) {
      logger.error('FetchWanted', `Errore durante la ricerca del link di download`, error)
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

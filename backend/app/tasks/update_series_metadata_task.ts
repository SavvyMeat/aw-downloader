import Config from '#models/config'
import Series from '#models/series'
import { logger } from '#services/logger_service'
import { SeriesMetadataSyncService } from '#services/series_metadata_sync_service'
import { getSonarrService } from '#services/sonarr_service'
import { BaseTask, ServiceType } from './base_task.js'

export class UpdateSeriesMetadataTask extends BaseTask {
  id = 'update_metadata'
  name = 'Aggiornamento Metadati Sonarr'
  description = 'Sincronizza i metadati delle serie tramite API Sonarr'
  defaultIntervalMinutes = 720 // 12 ore
  serviceType: ServiceType = 'sonarr'
  intervalConfigKey = 'sonarr_updatemetadata_interval'
  private metadataSyncService: SeriesMetadataSyncService
  private sonarrService = getSonarrService()

  constructor(intervalMinutes?: number) {
    super(intervalMinutes)
    this.metadataSyncService = new SeriesMetadataSyncService()
  }

  async execute(): Promise<void> {
    const enabled = (await Config.get<boolean>('sonarr_enabled')) ?? true
    if (!enabled) {
      logger.debug('UpdateSeriesMetadata', 'Sonarr disabilitato, task saltato')
      return
    }

    // Initialize Sonarr service
    await this.sonarrService.initialize()

    const filterAnimeOnly = (await Config.get<boolean>('sonarr_filter_anime_only')) ?? true

    // Get tag filtering configuration
    const tagsMode = await Config.get<string>('sonarr_tags_mode')
    const tagsConfig = await Config.get<Array<{ value: string; label: string }>>('sonarr_tags')
    const tagIds = tagsConfig?.map((tag) => parseInt(tag.value)) || []

    const allSeries = await this.sonarrService.getAllSeries()
    const monitoredSeries = allSeries
      // Filter only monitored series or anime if configured
      .filter(
        (show) => show.monitored && (!filterAnimeOnly || show.seriesType.toLowerCase() === 'anime')
      )
      // Apply tag filtering if configured
      .filter((show) => {
        if (!tagsMode || tagIds.length === 0) {
          return true
        }
        if (tagsMode === 'blacklist') {
          const seriesTags = show.tags || []
          return !tagIds.some((tagId) => seriesTags.includes(tagId))
        } else if (tagsMode === 'whitelist') {
          const seriesTags = show.tags || []
          return tagIds.some((tagId) => seriesTags.includes(tagId))
        }
      })

    logger.info('UpdateMetadata', `Trovate ${monitoredSeries.length} serie monitorate da sincronizzare`)

    // Get all existing series IDs from Sonarr
    const sonarrIds = monitoredSeries.map((show) => show.id)

    // Mark series as deleted if they're no longer in Sonarr or not monitored
    if (sonarrIds.length > 0) {
      await Series.query()
        .whereNotNull('sonarr_id')
        .whereNotIn('sonarr_id', sonarrIds)
        .update({ deleted: true })
    }

    // Sync each series with local database
    for (const sonarrShow of monitoredSeries) {
      await this.metadataSyncService.syncSeries(sonarrShow.id)
    }

    logger.success('UpdateMetadata', 'Sincronizzazione metadati completata')
  }
}

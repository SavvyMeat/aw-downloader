import Config from '#models/config'
import Film from '#models/film'
import { logger } from '#services/logger_service'
import { FilmMetadataSyncService } from '#services/film_metadata_sync_service'
import { getRadarrService } from '#services/radarr_service'
import { BaseTask, ServiceType } from './base_task.js'

export class UpdateFilmMetadataTask extends BaseTask {
  id = 'update_film_metadata'
  name = 'Aggiornamento Metadati Radarr'
  description = 'Sincronizza i metadati dei film tramite API Radarr'
  defaultIntervalMinutes = 720 // 12 ore
  serviceType: ServiceType = 'radarr'
  intervalConfigKey = 'radarr_updatemetadata_interval'
  private filmMetadataSyncService: FilmMetadataSyncService
  private radarrService = getRadarrService()

  constructor(intervalMinutes?: number) {
    super(intervalMinutes)
    this.filmMetadataSyncService = new FilmMetadataSyncService()
  }

  async execute(): Promise<void> {
    await this.radarrService.initialize()

    // Tag filtering configuration
    const tagsMode = await Config.get<string>('radarr_tags_mode')
    const tagsConfig = await Config.get<Array<{ value: string; label: string }>>('radarr_tags')
    const tagIds = tagsConfig?.map((tag) => parseInt(tag.value)) || []

    const allMovies = await this.radarrService.getAllMovies()
    const monitoredMovies = allMovies
      .filter((movie) => movie.monitored)
      .filter((movie) => {
        if (!tagsMode || tagIds.length === 0) {
          return true
        }
        const movieTags = movie.tags || []
        if (tagsMode === 'blacklist') {
          return !tagIds.some((tagId) => movieTags.includes(tagId))
        } else if (tagsMode === 'whitelist') {
          return tagIds.some((tagId) => movieTags.includes(tagId))
        }
        return true
      })

    logger.info('UpdateFilmMetadata', `Trovati ${monitoredMovies.length} film monitorati da sincronizzare`)

    const radarrIds = monitoredMovies.map((movie) => movie.id)

    // Mark films as deleted if they're no longer in Radarr or not monitored
    if (radarrIds.length > 0) {
      await Film.query().whereNotIn('radarr_id', radarrIds).update({ deleted: true })
    } else {
      await Film.query().update({ deleted: true })
    }

    for (const movie of monitoredMovies) {
      await this.filmMetadataSyncService.syncFilm(movie.id)
    }

    logger.success('UpdateFilmMetadata', 'Sincronizzazione metadati film completata')
  }
}

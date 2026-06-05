import { BaseTask, ServiceType } from './base_task.js'
import Config from '#models/config'
import Film from '#models/film'
import { getDownloadQueue } from '#services/download_queue'
import { AnimeworldService } from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import { getRadarrService, type RadarrWantedRecord } from '#services/radarr_service'
import { FilmMetadataSyncService } from '#services/film_metadata_sync_service'

export class FetchWantedFilmsTask extends BaseTask {
  id = 'fetch_wanted_films'
  name = 'Recupero Lista Wanted'
  description = 'Recupera la lista dei film mancanti da Radarr'
  defaultIntervalMinutes = 30
  serviceType: ServiceType = 'radarr'
  intervalConfigKey = 'radarr_fetchwanted_interval'

  private wantedMovies: RadarrWantedRecord[] = []
  private animeworldService: AnimeworldService
  private radarrService = getRadarrService()

  constructor(intervalMinutes?: number) {
    super(intervalMinutes)
    this.animeworldService = new AnimeworldService()
  }

  async execute(): Promise<void> {
    const enabled = (await Config.get<boolean>('radarr_enabled')) ?? false
    if (!enabled) {
      logger.debug('FetchWantedFilms', 'Radarr disabilitato, task saltato')
      return
    }

    await this.radarrService.initialize()

    // Tag filtering configuration (same logic as Sonarr, no anime/standard type for movies)
    const tagsMode = await Config.get<string>('radarr_tags_mode')
    const tagsConfig = await Config.get<Array<{ value: string; label: string }>>('radarr_tags')
    const tagIds = tagsConfig?.map((tag) => parseInt(tag.value)) || []

    // Fetch wanted/missing movies from Radarr (all pages)
    this.wantedMovies = []
    let currentPage = 1
    let totalRecords = 0
    const pageSize = 100

    do {
      const response = await this.radarrService.getWantedMissingMovies(
        pageSize,
        'digitalRelease',
        'descending',
        currentPage
      )

      totalRecords = response.totalRecords

      const filtered = response.records
        .filter((movie) => movie.monitored && movie.isAvailable)
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
      this.wantedMovies.push(...filtered)

      currentPage++
    } while ((currentPage - 1) * pageSize < totalRecords)

    logger.info('FetchWantedFilms', `Trovati ${this.wantedMovies.length} film mancanti`)

    await this.syncWantedFilmsMetadata()
    await this.addToDownloadQueue()
  }

  /**
   * Ensure all wanted films exist in the local database
   */
  private async syncWantedFilmsMetadata(): Promise<void> {
    const radarrIds = [...new Set(this.wantedMovies.map((m) => m.id))]

    const existingFilms = await Film.query().whereIn('radarrId', radarrIds).select('radarrId').pojo()
    const existingIds = existingFilms.map((f) => (f as { radarr_id: number }).radarr_id)
    const missingIds = radarrIds.filter((id) => !existingIds.includes(id))

    const filmMetadataSyncService = new FilmMetadataSyncService()
    for (const radarrId of missingIds) {
      await filmMetadataSyncService.syncFilm(radarrId)
    }
  }

  /**
   * Add missing films to the download queue
   */
  private async addToDownloadQueue(): Promise<void> {
    const queue = getDownloadQueue()
    let addedCount = 0
    let skippedCount = 0

    for (const wantedMovie of this.wantedMovies) {
      try {
        const film = await Film.findBy('radarr_id', wantedMovie.id)

        if (!film) {
          logger.warning(
            'FetchWantedFilms',
            `Film "${wantedMovie.title}" non trovato nel database`
          )
          continue
        }

        if (!film.animeworldUrl) {
          logger.warning(
            'FetchWantedFilms',
            `Nessun link AnimeWorld disponibile per "${film.title}"`
          )
          continue
        }

        // Skip if already queued/downloading
        const alreadyInQueue = queue
          .getAllItems()
          .some(
            (item) =>
              item.mediaType === 'film' &&
              item.filmId === film.id &&
              (item.status === 'pending' || item.status === 'downloading')
          )

        if (alreadyInQueue) {
          skippedCount++
          continue
        }

        // A film maps to "episode 1" of the AnimeWorld entry
        const downloadUrl = await this.animeworldService.findEpisodeDownloadLink(
          film.animeworldUrl,
          1
        )

        if (!downloadUrl) {
          logger.warning(
            'FetchWantedFilms',
            `Link di download non trovato per: ${film.title}`
          )
          continue
        }

        queue.addToQueue({
          mediaType: 'film',
          filmId: film.id,
          radarrId: film.radarrId,
          filmTitle: film.title,
          year: film.year,
          downloadUrl,
        })

        addedCount++
        logger.info('FetchWantedFilms', `Aggiunto alla coda: ${film.title}`)
      } catch (error) {
        logger.error('FetchWantedFilms', 'Errore durante l\'aggiunta del film alla coda', error)
      }
    }

    logger.info(
      'FetchWantedFilms',
      `Aggiunti ${addedCount} film alla coda (${skippedCount} già presenti)`
    )
  }

  getWantedCount(): number {
    return this.wantedMovies.length
  }
}

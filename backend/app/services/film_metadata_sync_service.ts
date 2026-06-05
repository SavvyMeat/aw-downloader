import Config from '#models/config'
import Film from '#models/film'
import { AniListService } from '#services/anilist_service'
import {
  AnimeTypeToFilterType,
  AnimeworldService,
  FilterDub,
  FilterSearchResult,
} from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import { getRadarrService, type RadarrMovie } from '#services/radarr_service'
import { SeriesMetadataSyncService } from '#services/series_metadata_sync_service'
import { SonarrAirDateInfo } from '#services/sonarr_service'
import app from '@adonisjs/core/services/app'
import axios from 'axios'
import fs from 'fs/promises'
import _ from 'lodash'
import { DateTime } from 'luxon'
import path from 'path'

export class FilmMetadataSyncService {
  private radarrService = getRadarrService()
  private animeworldService = new AnimeworldService()
  private anilistService = new AniListService()
  // Reuse the series matching logic (AniList/MAL cross-check + date window)
  private seriesMetadataSyncService = new SeriesMetadataSyncService()

  /**
   * Sync metadata for a single film
   * @param radarrId - The Radarr movie ID
   * @param refreshUrl - Force a fresh AnimeWorld search even if a URL is already set
   */
  async syncFilm(radarrId: number, refreshUrl: boolean = false): Promise<void> {
    await this.radarrService.initialize()

    const movie = await this.radarrService.getMovieById(radarrId)

    logger.debug('FilmMetadataSync', `Sincronizzazione in corso: ${movie.title}`)

    const film = await this.syncFilmFromRadarr(movie)
    await this.resolveAnimeworldUrl(film, movie, refreshUrl)

    logger.success('FilmMetadataSync', `Sincronizzazione completata: ${movie.title}`)
  }

  /**
   * Create or update the Film record from a Radarr movie
   */
  public async syncFilmFromRadarr(movie: RadarrMovie): Promise<Film> {
    let film = await Film.findBy('radarr_id', movie.id)

    const status = this.mapStatus(movie.status)

    // Poster caching (refresh at most every 48h)
    let posterPath: string | null = null
    let shouldDownloadPoster = true

    if (film?.posterPath && film?.posterDownloadedAt) {
      const hoursSinceLastDownload = DateTime.now().diff(film.posterDownloadedAt, 'hours').hours
      if (hoursSinceLastDownload < 48) {
        shouldDownloadPoster = false
        posterPath = film.posterPath
      }
    }

    if (shouldDownloadPoster) {
      const posterImage = movie.images.find((img) => img.coverType === 'poster')
      if (posterImage?.remoteUrl) {
        posterPath = await this.downloadPoster(movie.id, posterImage.remoteUrl)
      }
    }

    const alternateTitles = movie.alternateTitles?.map((alt) => alt.title) ?? null

    const filmData = {
      radarrId: movie.id,
      title: movie.title,
      description: movie.overview || null,
      status,
      posterPath,
      posterDownloadedAt:
        shouldDownloadPoster && posterPath ? DateTime.now() : film?.posterDownloadedAt || null,
      alternateTitles,
      genres: movie.genres ? JSON.stringify(movie.genres) : null,
      year: movie.year || null,
      studio: movie.studio || null,
      preferredLanguage:
        film?.preferredLanguage || (await Config.get<string>('preferred_language')) || 'sub',
      deleted: false,
    }

    if (film) {
      film.merge(filmData)
      await film.save()
      logger.debug('FilmMetadataSync', `Aggiornato film: ${movie.title}`)
    } else {
      film = await Film.create(filmData)
      logger.info('FilmMetadataSync', `Creato nuovo film: ${movie.title}`)
    }

    return film
  }

  /**
   * Search AnimeWorld for the movie and store the best matching identifier
   */
  private async resolveAnimeworldUrl(
    film: Film,
    movie: RadarrMovie,
    forceRefresh: boolean
  ): Promise<void> {
    if (film.animeworldUrl && !forceRefresh) {
      return
    }

    try {
      const airDateInfo = await this.buildAirDateInfo(movie)
      if (!airDateInfo.startDate || !airDateInfo.endDate) {
        logger.warning(
          'FilmMetadataSync',
          `Nessuna data di uscita valida per "${film.title}", impossibile cercare su AnimeWorld`
        )
        return
      }

      // Also pull alternate titles from AniList (same as series matching)
      const anilistTitles = await this.anilistService
        .searchAnime(film.title, film.year)
        .then((media) => Object.values(media?.title || {}).filter((t): t is string => !!t))
        .catch(() => [])

      // Candidate titles: main title + Radarr alternate titles + AniList titles, sanitized
      const candidateTitles = _.uniq(
        [film.title, ...anilistTitles, ...(film.alternateTitles ?? []) ]
          .map((t) => t.replace(/\(\d{4}\)/g, '').replace(/\(TV\)/gi, '').trim())
          .filter((t) => t && t.trim().length >= 2)
      )

      const releaseYear = DateTime.fromISO(airDateInfo.startDate).year
      const candidateYears = _.uniq([releaseYear, releaseYear - 1, releaseYear + 1])

      const shouldSearchSubbed =
        film.preferredLanguage === 'sub' || film.preferredLanguage === 'dub_fallback_sub'
      const shouldSearchDubbed =
        film.preferredLanguage === 'dub' || film.preferredLanguage === 'dub_fallback_sub'

      const doSearchMovie = async (dub: FilterDub): Promise<FilterSearchResult[]> => {
        const results: FilterSearchResult[] = []
        const titles = [...candidateTitles]
        while (results.length === 0 && titles.length > 0) {
          const res = await this.animeworldService.searchAnimeWithFilter({
            keyword: titles.shift()!,
            type: AnimeTypeToFilterType['Movie'],
            dub,
            seasonYear: candidateYears,
          })
          results.push(...res)
        }
        return results
      }

      const animeworldResults: FilterSearchResult[] = []
      if (shouldSearchSubbed) {
        animeworldResults.push(...(await doSearchMovie(FilterDub.Sub)))
      }
      if (shouldSearchDubbed) {
        animeworldResults.push(...(await doSearchMovie(FilterDub.Dub)))
      }

      // Cross-check with AniList/MAL and the release-date window
      const matches = await this.seriesMetadataSyncService.parseAnimeWorldResults(
        animeworldResults,
        airDateInfo,
        film.preferredLanguage
      )

      if (matches.length === 0) {
        logger.warning('FilmMetadataSync', `Link AnimeWorld non trovato per "${film.title}"`)
        return
      }

      // Order by start date and keep the earliest match
      matches.sort((a, b) => {
        const startA = a.anilistStartDate || a.malStartDate
        const startB = b.anilistStartDate || b.malStartDate
        return DateTime.fromISO(startA!).toMillis() - DateTime.fromISO(startB!).toMillis()
      })

      film.animeworldUrl = matches[0].animeworldIdentifier
      await film.save()

      logger.info('FilmMetadataSync', `Link AnimeWorld trovato per "${film.title}"`)
    } catch (error) {
      logger.error(
        'FilmMetadataSync',
        `Errore durante la ricerca AnimeWorld per "${film.title}"`,
        error
      )
      // Don't throw - just log and continue
    }
  }

  /**
   * Build an air-date window for a movie based on its release dates (or year as fallback)
   */
  private async buildAirDateInfo(movie: RadarrMovie): Promise<SonarrAirDateInfo> {
    const releaseInfo = await this.radarrService.getMovieReleaseDateInfo(movie.id)

    if (releaseInfo.releaseDate) {
      return {
        hasValidAirDate: true,
        startDate: releaseInfo.releaseDate,
        endDate: releaseInfo.releaseDate,
      }
    }

    // Fallback: prefer cinema release (closest to the AniList date), then physical, then digital
    const fallbackDate = movie.inCinemas || movie.physicalRelease || movie.digitalRelease
    if (fallbackDate) {
      return { hasValidAirDate: true, startDate: fallbackDate, endDate: fallbackDate }
    }

    if (movie.year) {
      const start = DateTime.fromObject({ year: movie.year, month: 1, day: 1 }).toISO()
      const end = DateTime.fromObject({ year: movie.year, month: 12, day: 31 }).toISO()
      return { hasValidAirDate: true, startDate: start, endDate: end }
    }

    return { hasValidAirDate: false, startDate: null, endDate: null }
  }

  /**
   * Download poster image for a film
   */
  private async downloadPoster(radarrId: number, posterUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(posterUrl, { responseType: 'arraybuffer' })
      const buffer = Buffer.from(response.data)

      const posterDir = app.makePath('storage/posters')
      await fs.mkdir(posterDir, { recursive: true })

      const ext = path.extname(posterUrl) || 'jpg'
      const filename = `film_${radarrId}.${ext}`
      const fullPath = path.join(posterDir, filename)

      await fs.writeFile(fullPath, buffer)

      return filename
    } catch (error) {
      logger.error('FilmMetadataSync', `Errore durante il download della locandina`, error)
      return null
    }
  }

  /**
   * Map Radarr status to our status
   */
  private mapStatus(radarrStatus: string): 'ongoing' | 'completed' | 'cancelled' {
    switch (radarrStatus.toLowerCase()) {
      case 'released':
        return 'completed'
      case 'announced':
      case 'incinemas':
        return 'ongoing'
      default:
        return 'ongoing'
    }
  }
}

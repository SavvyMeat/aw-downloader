import Config from '#models/config'
import Season from '#models/season'
import Series from '#models/series'
import { AniListMedia, AniListService } from '#services/anilist_service'
import {
  AnimeTypeToFilterType,
  AnimeworldService,
  FilterDub,
  FilterSearchResult,
} from '#services/animeworld_service'
import { logger } from '#services/logger_service'
import {
  getSonarrService,
  SonarrAirDateInfo,
  SonarrStatistics,
  type SonarrSeries,
} from '#services/sonarr_service'
import app from '@adonisjs/core/services/app'
import axios from 'axios'
import fs from 'fs/promises'
import _ from 'lodash'
import { DateTime } from 'luxon'
import path from 'path'
import { MyAnimeListAnime, MyAnimeListService } from './myanimelist_service.js'

export interface SeasonMatch {
  animeworldTitle: string
  animeworldIdentifier: string
  anilistId?: number
  anilistTitle?: string
  anilistStartDate?: string | null
  malId?: number
  malTitle?: string
  malStartDate?: string | null
  sonarrStartDate: string | null
  sonarrEndDate: string | null
}

export interface AnimeSeason {
  seasonNumber: number
  startDate: string
  endDate: string
  seasonYear: number | null
  season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
  episodes: number | null
  format: string
  anilistId: number
  titles: string[]
}

export class MetadataSyncService {
  private sonarrService = getSonarrService()
  private animeworldService = new AnimeworldService()
  private anilistService = new AniListService()
  private myanimelistService = new MyAnimeListService()

  /**
   * Sync metadata for a single series
   */
  async syncSeries(sonarrId: number, refreshUrls: boolean = false): Promise<void> {
    await this.sonarrService.initialize()

    // Get series data from Sonarr
    const sonarrShow = await this.sonarrService.getSeriesById(sonarrId)

    logger.debug('MetadataSync', `Sincronizzazione in corso: ${sonarrShow.title}`)

    const serie = await this.syncSeriesFromSonarr(sonarrShow)
    await this.syncSeasonsFromSonarr(serie, sonarrShow, refreshUrls)

    logger.success('MetadataSync', `Sincronizzazione completata: ${sonarrShow.title}`)
  }

  /**
   * Sync series data (title, poster, etc.)
   */
  public async syncSeriesFromSonarr(sonarrShow: SonarrSeries): Promise<Series> {
    // Check if series already exists
    let series = await Series.findBy('sonarr_id', sonarrShow.id)

    // Map Sonarr status to our status
    const status = this.mapStatus(sonarrShow.status)

    // Download and save poster image
    let posterPath: string | null = null
    let shouldDownloadPoster = true

    // Check if we should download the poster
    if (series?.posterPath && series?.posterDownloadedAt) {
      const hoursSinceLastDownload = DateTime.now().diff(series.posterDownloadedAt, 'hours').hours
      if (hoursSinceLastDownload < 48) {
        shouldDownloadPoster = false
        posterPath = series.posterPath
      }
    }

    if (shouldDownloadPoster) {
      const posterImage = sonarrShow.images.find((img) => img.coverType === 'poster')
      if (posterImage?.remoteUrl) {
        posterPath = await this.downloadPoster(sonarrShow.id, posterImage.remoteUrl)
      }
    }

    // Format alternate titles as JSON string (keep full objects with sceneSeasonNumber)
    const alternateTitles = JSON.stringify(sonarrShow.alternateTitles)

    // Format genres as JSON string
    const genres = JSON.stringify(sonarrShow.genres)

    const preferredLanguage = (await Config.get<string>('preferred_language')) || 'sub'

    const seriesData = {
      sonarrId: sonarrShow.id,
      title: sonarrShow.title,
      description: sonarrShow.overview || null,
      status,
      totalSeasons: sonarrShow.seasons.length,
      posterPath,
      posterDownloadedAt:
        shouldDownloadPoster && posterPath ? DateTime.now() : series?.posterDownloadedAt || null,
      alternateTitles,
      genres,
      preferredLanguage: series?.preferredLanguage || preferredLanguage,
      year: sonarrShow.year || null,
      network: sonarrShow.network || null,
      deleted: false, // Reset deleted flag if series is back in Sonarr
    }

    if (series) {
      // Update existing series
      series.merge(seriesData)
      await series.save()
      logger.debug('UpdateMetadata', `Aggiornata serie: ${sonarrShow.title}`)
    } else {
      // Create new series
      series = await Series.create(seriesData)
      logger.info('UpdateMetadata', `Creata nuova serie: ${sonarrShow.title}`)
    }

    return series
  }

  public async syncSeasonsFromSonarr(
    series: Series,
    sonarrSeries: SonarrSeries,
    forceRefresh: boolean = false
  ): Promise<Season[]> {
    // Filter only monitored seasons and exclude season 0 (specials)
    const candidateSeasons = sonarrSeries.seasons.filter(
      (season) => season.statistics.episodeCount > 0 && season.seasonNumber > 0 && season.monitored
    )

    // Filter seasons with valid episodes (async check)
    const monitoredSeasons = []
    for (const sonarrSeason of candidateSeasons) {
      const { hasValidAirDate } = await this.sonarrService.getSeasonAirDateInfo(
        sonarrSeries.id,
        sonarrSeason.seasonNumber
      )
      if (hasValidAirDate) {
        monitoredSeasons.push(sonarrSeason)
      }
    }

    const firstSeason = sonarrSeries.seasons.find((s) => s.seasonNumber == 1)
    if (!firstSeason) {
      logger.warning('UpdateMetadata', `Stagione 1 non trovata per "${series.title}"`)
      throw new Error(`No season 1 found for ${series.title}`)
    }

    const seasonsToInsert = series.absolute ? [firstSeason] : monitoredSeasons

    // Get season numbers from Sonarr (monitored seasons with valid episodes)
    const seasonNumbers = seasonsToInsert.map((season) => season.seasonNumber)

    // Mark seasons as deleted if they're no longer monitored or no longer in Sonarr
    if (seasonNumbers.length > 0) {
      await Season.query()
        .where('series_id', series.id)
        .whereNotIn('season_number', seasonNumbers)
        .update({ deleted: true })
    } else {
      // If no monitored seasons, mark all as deleted
      await Season.query().where('series_id', series.id).update({ deleted: true })
    }

    const syncedSeasons: Season[] = []

    const getEpisodeStats = (stats: SonarrStatistics) => {
      const airedEpisodes = stats.episodeCount || 0
      const downloadedEpisodes = stats.episodeFileCount || 0
      const totalEpisodes = stats.episodeCount || 0
      const missingEpisodes = Math.max(0, airedEpisodes - downloadedEpisodes)
      return {
        totalEpisodes,
        missingEpisodes,
        airedEpisodes,
      }
    }

    for (const sonarrSeason of seasonsToInsert) {
      // Check if season already exists
      let season = await Season.query()
        .where('series_id', series.id)
        .where('season_number', sonarrSeason.seasonNumber)
        .first()

      // Calculate missing episodes
      // episodeCount = episodes already aired
      // episodeFileCount = episodes downloaded
      // We only consider aired episodes, not future ones

      const { totalEpisodes, missingEpisodes, airedEpisodes } = series.absolute
        ? getEpisodeStats(sonarrSeries.statistics)
        : getEpisodeStats(sonarrSeason.statistics)

      const seasonData = {
        seriesId: series.id,
        seasonNumber: sonarrSeason.seasonNumber,
        title: `Stagione ${sonarrSeason.seasonNumber}`,
        totalEpisodes,
        missingEpisodes,
        status:
          missingEpisodes === 0 && airedEpisodes > 0
            ? ('completed' as const)
            : ('not_started' as const),
        deleted: false, // Reset deleted flag if season is back in Sonarr and monitored
      }

      if (season) {
        // Update existing season
        season.merge(seasonData)
        await season.save()
      } else {
        // Create new season
        season = await Season.create(seasonData)
      }

      syncedSeasons.push(season)
    }

    for (const season of syncedSeasons) {
      if (!season.downloadUrls || season.downloadUrls.length === 0 || forceRefresh) {
        await series.load('seasons')
        const seasonMatch = await this.findMatchingSeason(series, season.seasonNumber)
        if (seasonMatch && seasonMatch.length > 0) {
          season.downloadUrls = seasonMatch.map((s) => s.animeworldIdentifier)
          await season.save()
        } else {
          await this.searchAndSetAnimeworldUrl(series, season, season.seasonNumber)
        }
      }
    }

    logger.debug(
      'UpdateMetadata',
      `Sincronizzate ${syncedSeasons.length} stagioni per "${series.title}"`
    )
    return syncedSeasons
  }

  private async searchAndSetAnimeworldUrl(
    series: Series,
    season: Season,
    seasonNumber: number
  ): Promise<void> {
    try {
      if (series.absolute && seasonNumber !== 1) {
        logger.debug(
          'UpdateMetadata',
          `Series is absolute, skipping AnimeWorld search for season ${seasonNumber}`
        )
        return
      }

      // Build list of titles to try with metadata about their origin
      const titlesToTry: Array<{ title: string; isSeasonSpecific: boolean }> = [
        { title: series.title, isSeasonSpecific: false },
      ]

      // Add alternate titles if available, filtering by sceneSeasonNumber
      if (series.alternateTitles) {
        try {
          const alternates = JSON.parse(series.alternateTitles) as Array<{
            title: string
            sceneSeasonNumber: number
          }>

          // Filter: include titles where sceneSeasonNumber < 0 (all seasons)
          // or sceneSeasonNumber === seasonNumber (specific season)
          const relevantAlternates = alternates
            .filter((alt) => alt.sceneSeasonNumber < 0 || alt.sceneSeasonNumber === seasonNumber)
            .map((alt) => ({
              title: alt.title,
              isSeasonSpecific: alt.sceneSeasonNumber >= 0,
            }))

          titlesToTry.push(...relevantAlternates)
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Try each title
      for (const titleInfo of titlesToTry) {
        // Build search keyword: append season number only if > 1 AND not using a season-specific alternate title
        const searchKeyword =
          seasonNumber > 1 && !titleInfo.isSeasonSpecific
            ? `${titleInfo.title} ${seasonNumber}`
            : titleInfo.title

        const searchResults = await this.animeworldService.searchAnime(searchKeyword)

        if (searchResults.length === 0) {
          continue // Try next title
        }

        // Filter results based on preferred language
        let filteredResults = searchResults
        if (series.preferredLanguage === 'dub') {
          // Only dubbed versions (dub = 1)
          filteredResults = searchResults.filter((result) => result.dub == 1)
        } else if (series.preferredLanguage === 'sub') {
          // Only subbed versions (dub = 0)
          filteredResults = searchResults.filter((result) => result.dub == 0)
        } else if (series.preferredLanguage === 'dub_fallback_sub') {
          // Prefer dubbed, but allow subbed if no dubbed version is found
          const dubbedResults = searchResults.filter((result) => result.dub == 1)
          filteredResults =
            dubbedResults.length > 0
              ? dubbedResults
              : searchResults.filter((result) => result.dub == 0)
        }

        if (filteredResults.length === 0) {
          continue // Try next title
        }

        // Find best match and all related parts
        const matches = this.animeworldService.findBestMatchWithParts(
          filteredResults,
          searchKeyword
        )

        if (!matches || matches.length === 0) {
          continue // Try next title
        }

        // Get anime identifiers for all parts (store identifiers not full URLs)
        const animeIdentifiers: string[] = []
        for (const match of matches) {
          const identifier = this.animeworldService.getAnimeIdentifier(match.link, match.identifier)
          animeIdentifiers.push(identifier)
        }

        // Save identifiers to season's downloadUrls (will be automatically JSON encoded)
        season.downloadUrls = animeIdentifiers
        await season.save()

        logger.info(
          'UpdateMetadata',
          `Trovati ${animeIdentifiers.length} link per "${season.title}"`
        )
        return // Success, exit
      }

      logger.warning(
        'UpdateMetadata',
        `Link AnimeWorld non trovato per "${season.title}" stagione ${seasonNumber}`
      )
    } catch (error) {
      logger.error(
        'UpdateMetadata',
        `Errore durante la ricerca per la stagione ${seasonNumber}`,
        error
      )
      // Don't throw - just log and continue
    }
  }

  /**
   * Download poster image
   */
  private async downloadPoster(seriesId: number, posterUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(posterUrl, { responseType: 'arraybuffer' })
      const buffer = Buffer.from(response.data)

      const posterDir = app.makePath('storage/posters')
      await fs.mkdir(posterDir, { recursive: true })

      const ext = path.extname(posterUrl) || 'jpg'
      const filename = `series_${seriesId}.${ext}`
      const fullPath = path.join(posterDir, filename)

      await fs.writeFile(fullPath, buffer)

      return filename
    } catch (error) {
      logger.error('MetadataSync', `Errore durante il download della locandina`, error)
      return null
    }
  }

  /**
   * Map Sonarr status to our status
   */
  private mapStatus(sonarrStatus: string): 'ongoing' | 'completed' | 'cancelled' {
    switch (sonarrStatus.toLowerCase()) {
      case 'continuing':
        return 'ongoing'
      case 'ended':
        return 'completed'
      default:
        return 'cancelled'
    }
  }

  private async getAlternateTitles(
    series: Series
  ): Promise<
    Array<{ title: string; isSeasonSpecific: boolean; specificSeasonNumber: number | null }>
  > {
    // Build list of titles to try with metadata about their origin
    const titlesToTry: Array<{
      title: string
      isSeasonSpecific: boolean
      specificSeasonNumber: number | null
    }> = [{ title: series.title, isSeasonSpecific: false, specificSeasonNumber: null }]

    // Add alternate titles if available, filtering by sceneSeasonNumber
    if (series.alternateTitles) {
      try {
        const alternates = JSON.parse(series.alternateTitles) as Array<{
          title: string
          sceneSeasonNumber: number
        }>

        // Filter: include titles where sceneSeasonNumber < 0 (all seasons)
        // or sceneSeasonNumber === seasonNumber (specific season)
        const relevantAlternates = alternates
          .filter((alt) => alt.sceneSeasonNumber < 0)
          .map((alt) => ({
            title: alt.title,
            isSeasonSpecific: alt.sceneSeasonNumber >= 0,
            specificSeasonNumber: alt.sceneSeasonNumber,
          }))

        titlesToTry.push(...relevantAlternates)
      } catch {
        // Ignore JSON parse errors
      }
    }

    return titlesToTry
  }

  /**
   * Find matching seasons between a series and AnimeWorld/AniList results
   * @param series - The Sonarr series to match
   * @returns Array of season matches with metadata
   */
  private async findMatchingSeason(series: Series, seasonNumber: number): Promise<SeasonMatch[]> {
    try {
      logger.debug(
        'MetadataSync',
        `Ricerca corrispondenze per: ${series.title} Stagione ${seasonNumber}`
      )

      const candidateTitles = await this.getAlternateTitles(series)

      const airDateInfo = await this.sonarrService.getSeasonAirDateInfo(
        series.sonarrId,
        seasonNumber
      )

      if (!airDateInfo.startDate || !airDateInfo.endDate) {
        return [] // Skip seasons without valid air date
      }

      const baseSeriesTitlesFromAnilist = await this.anilistService
        .searchAnime(series.title, series.year)
        .then((media) => Object.values(media?.title || {}).filter((t) => t) as string[])
        .catch(() => [])

      const sanitizedSeriesTitles = [
        series.title,
        ...candidateTitles
          .filter(
            (t) =>
              !t.isSeasonSpecific || (t.isSeasonSpecific && t.specificSeasonNumber === seasonNumber)
          )
          .map((t) => t.title),
        ...baseSeriesTitlesFromAnilist,
      ]
        .map((t) => t.replace(/\(\d{4}\)/g, '')) // Remove years in parentheses like (2024)
        .map((t) => t.replace(/\(TV\)/gi, '')) // Remove (TV) case-insensitive
        .map((t) => t.trim()) // Trim after removals
      const uniqueSeriesTitles = _.uniq(sanitizedSeriesTitles.map((t) => t.trim()))

      // Search on AnimeWorld using filters
      const shouldSearchSubbed =
        series.preferredLanguage === 'sub' || series.preferredLanguage === 'dub_fallback_sub'
      const shouldSearchDubbed =
        series.preferredLanguage === 'dub' || series.preferredLanguage === 'dub_fallback_sub'

      const doSearchSeason = async (
        candidateTitles: string[],
        seasonYear: number[],
        dub: FilterDub
      ) => {
        const results: FilterSearchResult[] = []
        const candidateTitlesCopy = [...candidateTitles].filter((t) => t && t.trim().length >= 2)
        while (results.length === 0 && candidateTitlesCopy.length > 0) {
          const res = await this.animeworldService.searchAnimeWithFilter({
            keyword: candidateTitlesCopy.shift()!,
            type: AnimeTypeToFilterType['Anime'],
            dub,
            seasonYear,
          })
          results.push(...res)
        }
        return results
      }

      const candidateYears = _.range(
        DateTime.fromISO(airDateInfo.startDate).year,
        DateTime.fromISO(airDateInfo.endDate).year + 1
      )

      const seasonAnimeworldResults: FilterSearchResult[] = []

      // Search on animeworld using each title filtered by all years during which the season could have aired
      if (shouldSearchSubbed) {
        const results = await doSearchSeason(uniqueSeriesTitles, candidateYears, FilterDub.Sub)
        seasonAnimeworldResults.push(...results)
      }
      if (shouldSearchDubbed) {
        const results = await doSearchSeason(uniqueSeriesTitles, candidateYears, FilterDub.Dub)
        seasonAnimeworldResults.push(...results)
      }

      const matches: SeasonMatch[] = await this.parseAnimeWorldResults(
        seasonAnimeworldResults,
        airDateInfo,
        series.preferredLanguage
      )

      matches.sort((a: SeasonMatch, b: SeasonMatch) => {
        // Order by start date ascending
        const startDateA = a.anilistStartDate || a.malStartDate
        const startDateB = b.anilistStartDate || b.malStartDate

        return DateTime.fromISO(startDateA!).toMillis() - DateTime.fromISO(startDateB!).toMillis()
      })

      logger.debug('MetadataSync', `Trovate ${matches.length} corrispondenze per "${series.title}"`)

      return matches
    } catch (error) {
      logger.error(
        'MetadataSync',
        `Errore durante la ricerca delle corrispondenze per "${series.title}"`,
        error
      )
      throw error
    }
  }

  public async parseAnimeWorldResults(
    animeworldResults: FilterSearchResult[],
    airDateInfo: SonarrAirDateInfo,
    preferredLanguage: string
  ) {
    const dateStartWithMargin = DateTime.fromISO(airDateInfo.startDate!).minus({
      months: 1,
      days: 10,
    })
    const dateEndWithMargin = DateTime.fromISO(airDateInfo.endDate!).plus({ months: 1, days: 10 })

    const matches: SeasonMatch[] = []

    for (const awResult of animeworldResults) {
      if (preferredLanguage === 'dub' && awResult.dub !== FilterDub.Dub) continue // Skip non-dubbed results if preference is dub
      if (preferredLanguage === 'sub' && awResult.dub !== FilterDub.Sub) continue // Skip non-subbed results if preference is sub

      if (preferredLanguage === 'dub_fallback_sub') {
        // If preference is dub_fallback_sub, prioritize dubbed results
        if (awResult.dub === FilterDub.Sub) {
          const hasDubbedMatch = animeworldResults.find(
            (r) => r.title === awResult.title && r.dub === FilterDub.Dub
          )
          if (hasDubbedMatch) {
            continue // Skip subbed result if a dubbed version exists
          }
        }
      }

      if (!awResult.anilistId && !awResult.malId) continue // Skip if no AniList or MyAnimeList ID is available

      let anilistResult: AniListMedia | null = null
      if (awResult.anilistId) {
        anilistResult = await this.anilistService.getMediaById(awResult.anilistId)
      }

      let myanimelistResult: MyAnimeListAnime | null = null
      if (!anilistResult && awResult.malId) {
        myanimelistResult = await this.myanimelistService.getMediaById(awResult.malId)
      }

      if (!anilistResult && !myanimelistResult) continue

      if (anilistResult) {
        if (!anilistResult.startDateUtc) continue // Skip if no start date
        if (!anilistResult.airing && !anilistResult.endDateUtc) continue // Skip if not airing and not end date
        if (anilistResult.aired && !anilistResult.endDateUtc) {
          anilistResult.endDateUtc = anilistResult.startDateUtc
        }

        const anilistStartDate = DateTime.fromISO(anilistResult.startDateUtc)
        const anilistEndDate = anilistResult.endDateUtc
          ? DateTime.fromISO(anilistResult.endDateUtc)
          : null
        if (
          anilistStartDate < dateStartWithMargin ||
          (anilistEndDate && anilistEndDate > dateEndWithMargin)
        ) {
          continue // Skip if AniList dates are outside the air date range with margin
        }
      }

      if (myanimelistResult) {
        if (!myanimelistResult.startDateUtc) continue // Skip if no start or end date
        if (!myanimelistResult.airing && !myanimelistResult.endDateUtc) continue // Skip if not airing and not end date
        if (myanimelistResult.aired && !myanimelistResult.endDateUtc) {
          myanimelistResult.endDateUtc = myanimelistResult.startDateUtc
        }

        const myanimelistStartDate = DateTime.fromISO(myanimelistResult.startDateUtc)
        const myanimelistEndDate = myanimelistResult.endDateUtc
          ? DateTime.fromISO(myanimelistResult.endDateUtc)
          : null
        if (
          myanimelistStartDate < dateStartWithMargin ||
          (myanimelistEndDate && myanimelistEndDate > dateEndWithMargin)
        ) {
          continue // Skip if MyAnimeList dates are outside the air date range with margin
        }
      }

      matches.push({
        animeworldTitle: awResult.title,
        animeworldIdentifier: awResult.identifier,
        anilistId: anilistResult?.id,
        anilistTitle: anilistResult?.title.romaji || anilistResult?.title.english || '',
        anilistStartDate: anilistResult?.startDateUtc,
        malId: myanimelistResult?.id,
        malTitle: myanimelistResult?.title || '',
        malStartDate: myanimelistResult?.startDateUtc,
        sonarrStartDate: airDateInfo.startDate,
        sonarrEndDate: airDateInfo.endDate,
      })
    }
    return matches
  }
}

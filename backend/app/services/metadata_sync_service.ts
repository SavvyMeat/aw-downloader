import { getSonarrService, type SonarrSeries } from '#services/sonarr_service'
import { AnimeworldService } from '#services/animeworld_service'
import Series from '#models/series'
import Season from '#models/season'
import Episode from '#models/episode'
import { logger } from '#services/logger_service'
import { DateTime } from 'luxon'
import axios from 'axios'
import fs from 'fs/promises'
import app from '@adonisjs/core/services/app'
import path from 'path'

export class MetadataSyncService {
  private sonarrService = getSonarrService()
  private animeworldService = new AnimeworldService()

  /**
   * Sync metadata for a single series
   */
  async syncSeries(sonarrId: number, refreshUrls: boolean = false): Promise<void> {
    await this.sonarrService.initialize()

    // Get series data from Sonarr
    const sonarrShow = await this.sonarrService.getSeriesById(sonarrId)

    logger.info('MetadataSync', `Syncing series: ${sonarrShow.title}`)

    const serie = await this.syncSeriesFromSonarr(sonarrShow)
    const seasons = await this.syncSeasonsFromSonarr(
      serie,
      sonarrShow.id,
      sonarrShow.seasons,
      refreshUrls
    )

    for (const currentSeason of seasons) {
      await this.syncEpisodes(serie.id, currentSeason, serie.sonarrId, currentSeason.seasonNumber)
    }

    logger.success('MetadataSync', `Successfully synced series: ${sonarrShow.title}`)
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
      year: sonarrShow.year || null,
      network: sonarrShow.network || null,
      deleted: false, // Reset deleted flag if series is back in Sonarr
    }

    if (series) {
      // Update existing series
      series.merge(seriesData)
      await series.save()
      logger.info('UpdateMetadata', `Updated series: ${sonarrShow.title}`)
    } else {
      // Create new series
      series = await Series.create(seriesData)
      logger.success('UpdateMetadata', `Created series: ${sonarrShow.title}`)
    }

    return series
  }

  public async syncSeasonsFromSonarr(
    series: Series,
    sonarrSeriesId: number,
    sonarrSeasons: SonarrSeries['seasons'],
    forceRefresh: boolean = false
  ): Promise<Season[]> {
    // Filter only monitored seasons and exclude season 0 (specials)
    const candidateSeasons = sonarrSeasons.filter(
      (season) => season.monitored && season.seasonNumber > 0
    )

    // Filter seasons with valid episodes (async check)
    const monitoredSeasons = []
    for (const sonarrSeason of candidateSeasons) {
      const hasValidEpisodes = await this.sonarrService.seasonHasValidEpisodes(
        sonarrSeriesId,
        sonarrSeason.seasonNumber
      )
      if (hasValidEpisodes) {
        monitoredSeasons.push(sonarrSeason)
      }
    }

    // Get season numbers from Sonarr (monitored seasons with valid episodes)
    const sonarrSeasonNumbers = monitoredSeasons.map((season) => season.seasonNumber)

    // Mark seasons as deleted if they're no longer monitored or no longer in Sonarr
    if (sonarrSeasonNumbers.length > 0) {
      await Season.query()
        .where('series_id', series.id)
        .whereNotIn('season_number', sonarrSeasonNumbers)
        .update({ deleted: true })
    } else {
      // If no monitored seasons, mark all as deleted
      await Season.query().where('series_id', series.id).update({ deleted: true })
    }

    const syncedSeasons: Season[] = []

    for (const sonarrSeason of monitoredSeasons) {
      // Check if season already exists
      let season = await Season.query()
        .where('series_id', series.id)
        .where('season_number', sonarrSeason.seasonNumber)
        .first()

      // Calculate missing episodes
      // episodeCount = episodes already aired
      // episodeFileCount = episodes downloaded
      // We only consider aired episodes, not future ones
      const airedEpisodes = sonarrSeason.statistics?.episodeCount || 0
      const downloadedEpisodes = sonarrSeason.statistics?.episodeFileCount || 0
      const totalEpisodes = sonarrSeason.statistics?.totalEpisodeCount || 0
      const missingEpisodes = Math.max(0, airedEpisodes - downloadedEpisodes)

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

      // Try to find AnimeWorld URL if not already set
      if (!season.downloadUrls || season.downloadUrls.length === 0 || forceRefresh) {
        await this.searchAndSetAnimeworldUrl(
          season,
          series.title,
          series.alternateTitles,
          sonarrSeason.seasonNumber
        )
      }

      syncedSeasons.push(season)
    }

    logger.info('UpdateMetadata', `Synced ${monitoredSeasons.length} seasons for ${series.title}`)
    return syncedSeasons
  }

  /**
   * Sync episodes for a season
   */
  private async syncEpisodes(
    seriesId: number,
    season: Season,
    sonarrSeriesId: number,
    seasonNumber: number
  ): Promise<void> {
    try {
      // Fetch episodes from Sonarr for this series
      const sonarrEpisodesAll = await this.sonarrService.getSeriesEpisodes(sonarrSeriesId)

      const sonarrEpisodes = sonarrEpisodesAll.filter((ep) => ep.seasonNumber === seasonNumber)

      const now = DateTime.now()

      for (const sonarrEpisode of sonarrEpisodes) {
        // Check if episode already exists
        let episode = await Episode.query()
          .where('series_id', seriesId)
          .where('season_id', season.id)
          .where('sonarr_id', sonarrEpisode.id)
          .first()

        // Determine aired status
        let airedStatus: 'aired' | 'not_aired' = 'not_aired'
        if (sonarrEpisode.airDateUtc) {
          const airDate = DateTime.fromISO(sonarrEpisode.airDateUtc)
          airedStatus = airDate <= now ? 'aired' : 'not_aired'
        }

        // Determine disk status
        const diskStatus: 'downloaded' | 'missing' = sonarrEpisode.hasFile
          ? 'downloaded'
          : 'missing'

        const episodeData = {
          seriesId,
          seasonId: season.id,
          seasonNumber,
          sonarrId: sonarrEpisode.id,
          episodeNumber: sonarrEpisode.episodeNumber,
          title: sonarrEpisode.title,
          airDateUtc: sonarrEpisode.airDateUtc ? DateTime.fromISO(sonarrEpisode.airDateUtc) : null,
          airedStatus,
          diskStatus,
          monitored: sonarrEpisode.monitored,
        }

        if (episode) {
          // Update existing episode
          episode.merge(episodeData)
          await episode.save()
        } else {
          // Create new episode
          await Episode.create(episodeData)
        }
      }

      logger.info(
        'UpdateMetadata',
        `Synced ${sonarrEpisodes.length} episodes for season ${seasonNumber} of series ${seriesId}`
      )
    } catch (error) {
      logger.error(
        'UpdateMetadata',
        `Error syncing episodes for series ${seriesId}, season ${seasonNumber}`,
        error
      )
    }
  }

  private async searchAndSetAnimeworldUrl(
    season: Season,
    seriesTitle: string,
    alternateTitles: string | null,
    seasonNumber: number
  ): Promise<void> {
    try {
      // Build list of titles to try with metadata about their origin
      const titlesToTry: Array<{ title: string; isSeasonSpecific: boolean }> = [
        { title: seriesTitle, isSeasonSpecific: false },
      ]

      // Add alternate titles if available, filtering by sceneSeasonNumber
      if (alternateTitles) {
        try {
          const alternates = JSON.parse(alternateTitles) as Array<{
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

        logger.debug('UpdateMetadata', `Searching AnimeWorld for: ${searchKeyword}`)

        const searchResults = await this.animeworldService.searchAnime(searchKeyword)

        if (searchResults.length === 0) {
          continue // Try next title
        }

        // Find best match and all related parts
        const matches = this.animeworldService.findBestMatchWithParts(searchResults, searchKeyword)

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

        logger.success(
          'UpdateMetadata',
          `Set ${animeIdentifiers.length} AnimeWorld identifier(s) for ${season.title} season ${seasonNumber}`
        )
        return // Success, exit
      }

      logger.warning(
        'UpdateMetadata',
        `Could not find AnimeWorld URL for ${season.title} season ${seasonNumber} after trying ${titlesToTry.length} titles`
      )
    } catch (error) {
      logger.error('UpdateMetadata', `Error searching AnimeWorld for season ${seasonNumber}`, error)
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

      const ext = path.extname(posterUrl) || '.jpg'
      const filename = `series_${seriesId}.${ext}`
      const fullPath = path.join(posterDir, filename)

      await fs.writeFile(fullPath, buffer)

      logger.debug('MetadataSync', `Downloaded poster for series ${seriesId}`)
      return filename
    } catch (error) {
      logger.error('MetadataSync', `Error downloading poster for series ${seriesId}`, error)
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
}

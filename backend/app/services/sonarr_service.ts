import axios from 'axios'
import Config from '#models/config'
import { logger } from '#services/logger_service'
import { DateTime } from 'luxon'
import cache from '@adonisjs/cache/services/main'

export interface SonarrSeries {
  id: number
  title: string
  path: string
  alternateTitles: Array<{ title: string; sceneSeasonNumber: number }>
  overview: string
  status: string
  seriesType: string
  monitored: boolean
  seasons: Array<{
    seasonNumber: number
    monitored: boolean
    statistics?: {
      episodeCount: number
      episodeFileCount: number
      totalEpisodeCount: number
      percentOfEpisodes?: number
      previousAiring?: string
      sizeOnDisk?: number
    }
  }>
  year: number
  network: string
  genres: string[]
  images: Array<{ coverType: string; url: string; remoteUrl: string }>
}

export interface SonarrEpisode {
  id: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  airDateUtc: string | null
  monitored: boolean
  hasFile: boolean
  episodeFileId?: number
}

export interface SonarrWantedRecord {
  id: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  airDateUtc: string
  monitored: boolean
}

export interface SonarrWantedResponse {
  records: SonarrWantedRecord[]
  totalRecords: number
}

export interface SonarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  totalSpace: number
  unmappedFolders?: Array<{ name: string; path: string }>
}

interface SeriesCache {
  series: SonarrSeries
  timestamp: number
}

export class SonarrService {
  private sonarrUrl: string | null = null
  private sonarrToken: string | null = null
  private static healthy: boolean = false
  private static lastCheck: Date | null = null
  private static seriesCache: Map<number, SeriesCache> = new Map()
  private static CACHE_TTL = 5 * 60 * 1000 // 5 minutes in milliseconds

  /**
   * Initialize the service with Sonarr configuration
   * This should be called before making any API requests
   */
  async initialize(): Promise<void> {
    this.sonarrUrl = await Config.get('sonarr_url')
    this.sonarrToken = await Config.get('sonarr_token')

    if (!this.sonarrUrl || !this.sonarrToken) {
      throw new Error('Sonarr URL or API token not configured')
    }
  }

  /**
   * Check if the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.sonarrUrl || !this.sonarrToken) {
      throw new Error('SonarrService not initialized. Call initialize() first.')
    }
  }

  /**
   * Check if Sonarr is healthy before making requests
   */
  private ensureHealthy(): void {
    if (!SonarrService.healthy) {
      throw new Error('Sonarr is currently unavailable. Please check your configuration.')
    }
  }

  /**
   * Fetch all series from Sonarr
   */
  async getAllSeries(): Promise<SonarrSeries[]> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      const response = await axios.get<SonarrSeries[]>(`${this.sonarrUrl}/api/v3/series`, {
        headers: {
          'X-Api-Key': this.sonarrToken,
        },
      })

      logger.debug('SonarrService', `Fetched ${response.data.length} series from Sonarr`)
      return response.data
    } catch (error) {
      logger.error('SonarrService', 'Error fetching series from Sonarr', error)
      throw error
    }
  }

  /**
   * Get episodes for a specific series
   */
  async getSeriesEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
    const cacheKey = `series_episodes:${seriesId}`

    try {
      // Try to get from cache first
      const cached = await cache.get({ key: cacheKey })
      if (cached !== null && cached !== undefined) {
        return cached as SonarrEpisode[]
      }

      this.ensureInitialized()
      this.ensureHealthy()

      const response = await axios.get<SonarrEpisode[]>(
        `${this.sonarrUrl}/api/v3/episode?seriesId=${seriesId}`,
        {
          headers: {
            'X-Api-Key': this.sonarrToken,
          },
        }
      )

      logger.debug('SonarrService', `Fetched ${response.data.length} episodes for series ${seriesId}`)

      // Cache the result for 5 minutes
      await cache.set({ key: cacheKey, value: response.data, ttl: '5m' })

      return response.data
    } catch (error) {
      logger.error('SonarrService', `Error fetching episodes for series ${seriesId}`, error)
      throw error
    }
  }

  /**
   * Get a single series by ID with caching (5 minutes TTL)
   * @param seriesId - The Sonarr series ID
   * @returns The series data
   */
  async getSeriesById(seriesId: number): Promise<SonarrSeries> {
    this.ensureInitialized()
    this.ensureHealthy()

    // Check cache
    const cached = SonarrService.seriesCache.get(seriesId)
    const now = Date.now()

    if (cached && (now - cached.timestamp) < SonarrService.CACHE_TTL) {
      logger.debug('SonarrService', `Using cached data for series ${seriesId}`)
      return cached.series
    }

    try {
      logger.debug('SonarrService', `Fetching series ${seriesId} from Sonarr`)
      const response = await axios.get<SonarrSeries>(
        `${this.sonarrUrl}/api/v3/series/${seriesId}`,
        {
          headers: {
            'X-Api-Key': this.sonarrToken,
          },
        }
      )

      // Update cache
      SonarrService.seriesCache.set(seriesId, {
        series: response.data,
        timestamp: now,
      })

      logger.debug('SonarrService', `Cached series ${seriesId} data`)
      return response.data
    } catch (error) {
      logger.error('SonarrService', `Error fetching series ${seriesId}`, error)
      throw error
    }
  }

  /**
   * Clear cache for a specific series or all series
   * @param seriesId - Optional series ID to clear. If not provided, clears all cache
   */
  static clearSeriesCache(seriesId?: number): void {
    if (seriesId !== undefined) {
      SonarrService.seriesCache.delete(seriesId)
      logger.debug('SonarrService', `Cleared cache for series ${seriesId}`)
    } else {
      SonarrService.seriesCache.clear()
      logger.debug('SonarrService', 'Cleared all series cache')
    }
  }

  /**
   * Fetch wanted/missing episodes from Sonarr
   */
  async getWantedMissingEpisodes(
    pageSize: number = 100,
    sortKey: string = 'airDateUtc',
    sortDirection: 'ascending' | 'descending' = 'descending'
  ): Promise<SonarrWantedResponse> {
    this.ensureInitialized()

    try {
      const response = await axios.get<SonarrWantedResponse>(
        `${this.sonarrUrl}/api/v3/wanted/missing`,
        {
          headers: {
            'X-Api-Key': this.sonarrToken,
          },
          params: {
            pageSize,
            sortKey,
            sortDirection,
          },
        }
      )

      return response.data
    } catch (error) {
      logger.error('SonarrService', 'Error fetching wanted/missing episodes', error)
      throw error
    }
  }

  /**
   * Check if a season has episodes with valid air dates
   * Results are cached for 5 minutes
   */
  async seasonHasValidEpisodes(seriesId: number, seasonNumber: number): Promise<boolean> {
    this.ensureInitialized()

    const cacheKey = `season_valid_episodes:${seriesId}:${seasonNumber}`

    try {
      // Try to get from cache first
      const cached = await cache.get({ key: cacheKey })
      if (cached !== null && cached !== undefined) {
        return cached as boolean
      }

      // Not in cache, fetch from API
      const episodes = await this.getSeriesEpisodes(seriesId)
      const seasonEpisodes = episodes.filter((ep) => ep.seasonNumber === seasonNumber)

      // Check if at least one episode has a valid air date (past or up to 2 weeks in the future)
      const now = DateTime.now()
      const twoWeeksFromNow = now.plus({ weeks: 2 })
      
      const hasValidAirDate = seasonEpisodes.some((ep) => {
        if (!ep.airDateUtc || ep.airDateUtc === null) {
          return false
        }
        
        const airDate = DateTime.fromISO(ep.airDateUtc)
        return airDate.isValid && airDate <= twoWeeksFromNow
      })

      // Cache the result for 5 minutes
      await cache.set({ key: cacheKey, value: hasValidAirDate, ttl: '5m' })

      return hasValidAirDate
    } catch (error) {
      logger.error('SonarrService', `Error checking episodes for series ${seriesId}, season ${seasonNumber}`, error)
      return false
    }
  }

  /**
   * Get monitored anime series from Sonarr
   */
  async getMonitoredAnimeSeries(): Promise<SonarrSeries[]> {
    const allSeries = await this.getAllSeries()
    
    // Filter only anime series that are monitored
    const animeSeries = allSeries.filter(
      (show) => show.seriesType.toLowerCase() === 'anime' && show.monitored
    )

    logger.debug('SonarrService', `Found ${animeSeries.length} monitored anime series out of ${allSeries.length} total`)
    return animeSeries
  }

  /**
   * Get root folders from Sonarr
   */
  async getRootFolders(): Promise<SonarrRootFolder[]> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      const response = await axios.get<SonarrRootFolder[]>(
        `${this.sonarrUrl}/api/v3/rootfolder`,
        {
          headers: {
            'X-Api-Key': this.sonarrToken,
          },
        }
      )

      logger.debug('SonarrService', `Fetched ${response.data.length} root folders from Sonarr`)
      return response.data
    } catch (error) {
      logger.error('SonarrService', 'Error fetching root folders from Sonarr', error)
      throw error
    }
  }

  /**
   * Test Sonarr connection and update health status
   */
  async testConnection(): Promise<boolean> {
    this.ensureInitialized()

    try {
      await axios.get(`${this.sonarrUrl}/api/v3/system/status`, {
        headers: {
          'X-Api-Key': this.sonarrToken,
        },
        timeout: 5000,
      })
      return true
    } catch (error) {
      logger.error('SonarrService', 'Connection test failed', error)
      return false
    }
  }

  /**
   * Perform health check and update status
   */
  static async performHealthCheck(): Promise<boolean> {
    try {
      const sonarrUrl = await Config.get('sonarr_url')
      const sonarrToken = await Config.get('sonarr_token')

      if (!sonarrUrl || !sonarrToken) {
        SonarrService.healthy = false
        SonarrService.lastCheck = new Date()
        return false
      }

      const service = new SonarrService()
      await service.initialize()
      const isHealthy = await service.testConnection()

      SonarrService.healthy = isHealthy
      SonarrService.lastCheck = new Date()

      return isHealthy
    } catch (error) {
      logger.error('SonarrService', 'Health check failed', error)
      SonarrService.healthy = false
      SonarrService.lastCheck = new Date()
      return false
    }
  }

  /**
   * Get current health status
   */
  static getHealthStatus(): { healthy: boolean; lastCheck: Date | null } {
    return {
      healthy: SonarrService.healthy,
      lastCheck: SonarrService.lastCheck,
    }
  }

  /**
   * Invalidate health check cache (call after config changes)
   */
  static invalidateHealthCache(): void {
    SonarrService.lastCheck = null
    // Trigger immediate check
    SonarrService.performHealthCheck()
  }

  /**
   * Trigger a rescan/refresh for a specific series
   * This tells Sonarr to scan the series folder for new files
   */
  async rescanSeries(seriesId: number): Promise<void> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      logger.debug('SonarrService', `Triggering rescan for series ${seriesId}`)
      
      await axios.post(
        `${this.sonarrUrl}/api/v3/command`,
        {
          name: 'RescanSeries',
          seriesId: seriesId,
        },
        {
          headers: {
            'X-Api-Key': this.sonarrToken!,
          },
        }
      )

      logger.success('SonarrService', `Successfully triggered rescan for series ${seriesId}`)
    } catch (error) {
      logger.error('SonarrService', `Failed to trigger rescan for series ${seriesId}`, error)
      throw new Error(`Failed to rescan series: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

// Export a singleton instance
let sonarrServiceInstance: SonarrService | null = null

export function getSonarrService(): SonarrService {
  if (!sonarrServiceInstance) {
    sonarrServiceInstance = new SonarrService()
  }
  return sonarrServiceInstance
}

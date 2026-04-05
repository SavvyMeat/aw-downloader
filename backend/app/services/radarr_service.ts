import axios from 'axios'
import Config from '#models/config'
import { logger } from '#services/logger_service'
import { DateTime } from 'luxon'
import cache from '@adonisjs/cache/services/main'

export interface RadarrStatistics {
  movieFileCount: number
  sizeOnDisk?: number
}

export interface RadarrMovie {
  id: number
  title: string
  path: string
  alternateTitles: Array<{ title: string; sourceType: string }>
  overview: string
  status: string
  monitored: boolean
  year: number
  studio: string
  genres: string[]
  tags: number[]
  images: Array<{ coverType: string; url: string; remoteUrl: string }>
  statistics: RadarrStatistics
  hasFile: boolean
  movieFile?: {
    id: number
    relativePath: string
    path: string
    size: number
    dateAdded: string
    quality: {
      quality: {
        id: number
        name: string
        resolution: number
      }
    }
  }
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  minimumAvailability: string
  isAvailable: boolean
}

export interface RadarrWantedRecord {
  id: number
  title: string
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  monitored: boolean
  isAvailable: boolean
}

export interface RadarrWantedResponse {
  records: RadarrWantedRecord[]
  totalRecords: number
}

export interface RadarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  totalSpace: number
  unmappedFolders?: Array<{ name: string; path: string }>
}

export interface RadarrTag {
  id: number
  label: string
}

export interface RadarrReleaseDateInfo {
  hasValidReleaseDate: boolean
  releaseDate: string | null
  releaseType: 'cinema' | 'physical' | 'digital' | null
}

export class RadarrService {
  private radarrUrl: string | null = null
  private radarrToken: string | null = null
  private static healthy: boolean = false
  private static lastCheck: Date | null = null

  /**
   * Initialize the service with Radarr configuration
   * This should be called before making any API requests
   */
  async initialize(): Promise<void> {
    this.radarrUrl = await Config.get('radarr_url')
    this.radarrToken = await Config.get('radarr_token')

    if (!this.radarrUrl || !this.radarrToken) {
      throw new Error('Radarr URL or API token not configured')
    }
    this.radarrUrl = this.radarrUrl.replace(/\/+$/, '')
  }

  /**
   * Check if the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.radarrUrl || !this.radarrToken) {
      throw new Error('RadarrService not initialized. Call initialize() first.')
    }
  }

  /**
   * Check if Radarr is healthy before making requests
   */
  private ensureHealthy(): void {
    if (!RadarrService.healthy) {
      throw new Error('Radarr is currently unavailable. Please check your configuration.')
    }
  }

  /**
   * Get a single movie by ID
   * @param movieId - The Radarr movie ID
   * @returns The movie data
   */
  async getMovieById(movieId: number): Promise<RadarrMovie> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      const response = await axios.get<RadarrMovie>(`${this.radarrUrl}/api/v3/movie/${movieId}`, {
        headers: {
          'X-Api-Key': this.radarrToken,
        },
      })

      return response.data
    } catch (error) {
      logger.error('RadarrService', `Errore durante il recupero del film`, error)
      throw error
    }
  }

  /**
   * Fetch wanted/missing movies from Radarr
   */
  async getWantedMissingMovies(
    pageSize: number = 100,
    sortKey: string = 'digitalRelease',
    sortDirection: 'ascending' | 'descending' = 'descending',
    page: number = 1
  ): Promise<RadarrWantedResponse> {
    this.ensureInitialized()

    try {
      const response = await axios.get<RadarrWantedResponse>(
        `${this.radarrUrl}/api/v3/wanted/missing`,
        {
          headers: {
            'X-Api-Key': this.radarrToken,
          },
          params: {
            page,
            pageSize,
            sortKey,
            sortDirection,
            monitored: true,
          },
        }
      )

      return response.data
    } catch (error) {
      logger.error('RadarrService', 'Errore durante il recupero dei film mancanti', error)
      throw error
    }
  }

  /**
   * Check if a movie has a valid release date
   * Results are cached for 5 minutes
   */
  async getMovieReleaseDateInfo(movieId: number): Promise<RadarrReleaseDateInfo> {
    this.ensureInitialized()

    const cacheKey = `movie_release_date:${movieId}`

    try {
      // Try to get from cache first
      const cached = await cache.get({ key: cacheKey })
      if (cached !== null && cached !== undefined) {
        return cached as RadarrReleaseDateInfo
      }

      // Not in cache, fetch from API
      const movie = await this.getMovieById(movieId)

      let hasValidReleaseDate = false
      let releaseDate: string | null = null
      let releaseType: 'cinema' | 'physical' | 'digital' | null = null

      const now = DateTime.now()
      const twoWeeksFromNow = now.plus({ weeks: 2 })

      // Check digital release first (most relevant for downloads)
      if (movie.digitalRelease) {
        const digital = DateTime.fromISO(movie.digitalRelease)
        if (digital.isValid && digital <= twoWeeksFromNow) {
          hasValidReleaseDate = true
          releaseDate = movie.digitalRelease
          releaseType = 'digital'
        }
      }

      // Then check physical release
      if (!hasValidReleaseDate && movie.physicalRelease) {
        const physical = DateTime.fromISO(movie.physicalRelease)
        if (physical.isValid && physical <= twoWeeksFromNow) {
          hasValidReleaseDate = true
          releaseDate = movie.physicalRelease
          releaseType = 'physical'
        }
      }

      // Finally check cinema release
      if (!hasValidReleaseDate && movie.inCinemas) {
        const cinema = DateTime.fromISO(movie.inCinemas)
        if (cinema.isValid && cinema <= twoWeeksFromNow) {
          hasValidReleaseDate = true
          releaseDate = movie.inCinemas
          releaseType = 'cinema'
        }
      }

      const response = { hasValidReleaseDate, releaseDate, releaseType }

      // Cache the result for 5 minutes
      await cache.set({ key: cacheKey, value: response, ttl: '5m' })

      return response
    } catch (error) {
      logger.error('RadarrService', `Errore durante il controllo della data di uscita`, error)
      return { hasValidReleaseDate: false, releaseDate: null, releaseType: null }
    }
  }

  /**
   * Get root folders from Radarr
   */
  async getRootFolders(): Promise<RadarrRootFolder[]> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      const response = await axios.get<RadarrRootFolder[]>(`${this.radarrUrl}/api/v3/rootfolder`, {
        headers: {
          'X-Api-Key': this.radarrToken,
        },
      })

      return response.data
    } catch (error) {
      logger.error('RadarrService', 'Errore durante il recupero delle cartelle root', error)
      throw error
    }
  }

  /**
   * Get all tags from Radarr
   */
  async getTags(): Promise<RadarrTag[]> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      const response = await axios.get<RadarrTag[]>(`${this.radarrUrl}/api/v3/tag`, {
        headers: {
          'X-Api-Key': this.radarrToken,
        },
      })

      return response.data
    } catch (error) {
      logger.error('RadarrService', 'Errore durante il recupero dei tag', error)
      throw error
    }
  }

  /**
   * Test Radarr connection and update health status
   */
  async testConnection(): Promise<boolean> {
    this.ensureInitialized()

    try {
      await axios.get(`${this.radarrUrl}/api/v3/system/status`, {
        headers: {
          'X-Api-Key': this.radarrToken,
        },
        timeout: 5000,
      })
      return true
    } catch (error) {
      logger.error('RadarrService', 'Test di connessione fallito', error)
      return false
    }
  }

  /**
   * Perform health check and update status
   */
  static async performHealthCheck(): Promise<boolean> {
    try {
      const radarrUrl = await Config.get('radarr_url')
      const radarrToken = await Config.get('radarr_token')

      if (!radarrUrl || !radarrToken) {
        RadarrService.healthy = false
        RadarrService.lastCheck = new Date()
        return false
      }

      const service = new RadarrService()
      await service.initialize()
      const isHealthy = await service.testConnection()

      RadarrService.healthy = isHealthy
      RadarrService.lastCheck = new Date()

      return isHealthy
    } catch (error) {
      logger.error('RadarrService', 'Healthcheck fallito', error)
      RadarrService.healthy = false
      RadarrService.lastCheck = new Date()
      return false
    }
  }

  /**
   * Get current health status
   */
  static getHealthStatus(): { healthy: boolean; lastCheck: Date | null } {
    return {
      healthy: RadarrService.healthy,
      lastCheck: RadarrService.lastCheck,
    }
  }

  /**
   * Invalidate health check cache (call after config changes)
   */
  static invalidateHealthCache(): void {
    RadarrService.lastCheck = null
    // Trigger immediate check
    RadarrService.performHealthCheck()
  }

  /**
   * Trigger a rescan/refresh for a specific movie
   * This tells Radarr to scan the movie folder for new files
   */
  async rescanMovie(movieId: number): Promise<void> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      await axios.post(
        `${this.radarrUrl}/api/v3/command`,
        {
          name: 'RescanMovie',
          movieId: movieId,
        },
        {
          headers: {
            'X-Api-Key': this.radarrToken!,
          },
        }
      )
    } catch (error) {
      logger.error('RadarrService', `Impossibile avviare la scansione del film`, error)
      throw new Error(
        `Failed to rescan movie: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Trigger a rename for a specific movie file
   * This tells Radarr to rename the movie file according to the naming scheme
   * @param movieId - The movie ID from Radarr
   */
  async renameMovieFile(movie: RadarrMovie): Promise<void> {
    this.ensureInitialized()
    this.ensureHealthy()

    try {
      if (!movie.movieFile?.id) {
        throw new Error(`${movie.title} (${movie.year}) does not have a valid file ID`)
      }

      await axios.post(
        `${this.radarrUrl}/api/v3/command`,
        {
          name: 'RenameFiles',
          movieId: movie.id,
          files: [movie.movieFile.id],
        },
        {
          headers: {
            'X-Api-Key': this.radarrToken!,
          },
        }
      )
    } catch (error) {
      throw new Error(
        `Failed to rename movie file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

// Export a singleton instance
let radarrServiceInstance: RadarrService | null = null

export function getRadarrService(): RadarrService {
  if (!radarrServiceInstance) {
    radarrServiceInstance = new RadarrService()
  }
  return radarrServiceInstance
}

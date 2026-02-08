import { logger } from '#services/logger_service'
import got from 'got'
import pThrottle from 'p-throttle'

export interface MyAnimeListAnimeResponse {
  mal_id: number
  aired: {
    from: string | null
    to: string | null
  }
  episodes: number | null
  type: 'TV' | 'OVA' | 'Movie' | 'Special' | 'ONA' | 'Music'
  airing: boolean
  status: 'Finished Airing' | 'Currently Airing' | 'Not yet aired'
  season: 'summer' | 'winter' | 'spring' | 'fall'
  titles: Array<{
    type: 'Default' | 'Synonym' | 'Japanese' | 'English'
    title: string
  }>
}

export type MyAnimeListAnime = Pick<
  MyAnimeListAnimeResponse,
  'episodes' | 'titles' | 'type' | 'season' | 'airing'
> &
  Partial<{
    id: number
    title: string
    aired: boolean
    startDateUtc?: string | null
    endDateUtc?: string | null
  }>

export interface ErrorResponse {
  status: number
  type: string
  message: string
  error: string
  report_url: string
}

export interface SuccesssResponse<T> {
  data: T
}

export class MyAnimeListService {
  private apiUrl = 'https://api.jikan.moe/v4/'
  private _fetchData: <T = any>(endpoint: string, parameters?: Record<string, any>) => Promise<T>

  constructor() {
    // Max 3 per second
    const secondThrottle = pThrottle({
      limit: 3,
      interval: 1000,
    })

    // Max 60 per minute
    const minuteThrottle = pThrottle({
      limit: 60,
      interval: 60 * 1000, // 60000 ms
    })

    // 2. Definisci il metodo "throttled" nel costruttore
    // Usiamo una arrow function per mantenere il contesto 'this' corretto
    this._fetchData = minuteThrottle(
      secondThrottle(async <T = any>(...args: [query: string, variables?: Record<string, any>]) => {
        return this._performRequest<T>(...args)
      })
    )
  }

  /**
   * Make a GraphQL request to AniList API with rate limiting handling
   * Handles rate limits (90 req/min) and automatic retry with delay
   * @param query - The GraphQL query string
   * @param variables - The query variables
   * @returns The response body
   */
  private async _performRequest<T = any>(endpoint: string, parameters?: Object): Promise<T> {
    try {
      let url = `${this.apiUrl}${endpoint}`
      if (parameters) {
        const queryParams = new URLSearchParams(parameters as Record<string, string>)
        url += `?${queryParams.toString()}`
      }

      const response = await got.get(url, {
        responseType: 'json',
        timeout: {
          request: 10000,
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      })

      return response.body as T
    } catch (error: any) {
      // Handle 429 Too Many Requests
      if (error.response?.statusCode === 429) {
        // Wait and retry once
        await new Promise((resolve) => setTimeout(resolve, 10000)) // Wait 10 seconds

        // Recursive retry (only once)
        return this._performRequest<T>(endpoint, parameters)
      }

      throw error
    }
  }

  /**
   * Get anime by MyAnimeList ID
   * @param id - The MyAnimeList anime ID
   * @returns The MyAnimeList anime object or null if not found
   */
  async getMediaById(id: number): Promise<MyAnimeListAnime | null> {
    try {
      const response = await this._fetchData<SuccesssResponse<MyAnimeListAnimeResponse>>(
        `anime/${id}`
      )

      const toDate = response.data.aired.to || response.data.aired.from || null

      const malAnime: MyAnimeListAnime = {
        id: response.data.mal_id,
        startDateUtc: response.data.aired.from,
        endDateUtc: toDate,
        episodes: response.data.episodes,
        type: response.data.type,
        season: response.data.season,
        airing: response.data.airing,
        aired: response.data.status === 'Finished Airing',
        title: response.data.titles?.find((title) => title.type === 'Default')?.title || '',
        titles: response.data.titles.map((title) => ({
          type: title.type,
          title: title.title,
        })),
      }

      return malAnime
    } catch (error: any) {
      // Handle 404 - anime not found
      if (error.response?.statusCode === 404) {
        logger.warning('MyAnimeList', `Anime non trovato (404) con ID: ${id}`)
        return null
      }

      // Handle other HTTP errors (except 429 which is handled in _performRequest)
      if (error.response?.statusCode && error.response.statusCode !== 429) {
        logger.error(
          'MyAnimeList',
          `Errore HTTP ${error.response.statusCode} durante il recupero dell'anime con ID ${id}`,
          error
        )
        return null
      }

      // Handle network or other errors
      logger.error('MyAnimeList', `Errore durante il recupero dell'anime con ID ${id}`, error)
      throw new Error(
        `Failed to fetch anime from MyAnimeList: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

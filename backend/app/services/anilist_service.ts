import got from 'got'
import { logger } from '#services/logger_service'
import { DateTime } from 'luxon'
import { Utility } from '../helpers/utility.js'

export interface AniListDate {
  year: number | null
  month: number | null
  day: number | null
}

export interface AniListTitle {
  romaji: string | null
  english: string | null
  userPreferred: string | null
}

export interface AniListMedia {
  id: number
  startDate: AniListDate
  endDate: AniListDate
  startDateUtc: string | null // ISO 8601 UTC date string for easy comparisons
  endDateUtc: string | null // ISO 8601 UTC date string for easy comparisons
  title: AniListTitle
  episodes: number | null
  seasonYear: number | null
  season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
  format:
    | 'TV'
    | 'TV_SHORT'
    | 'MOVIE'
    | 'SPECIAL'
    | 'OVA'
    | 'ONA'
    | 'MUSIC'
    | 'MANGA'
    | 'NOVEL'
    | 'ONE_SHOT'
}

export interface AniListSearchResponse {
  data: {
    Media: AniListMedia
  }
}

export interface AniListSeasonPartsResponse {
  data: {
    Page: {
      media: AniListMedia[]
      pageInfo: {
        total: number
      }
    }
  }
}

const AnimeTypeToAnilistType = {
  ANIME: ['TV', 'TV_SHORT', 'ONA'],
  MOVIE: ['MOVIE'],
}

export class AniListService {
  private apiUrl = 'https://graphql.anilist.co'
  private rateLimitRemaining = 90
  private rateLimitReset: number | null = null

  /**
   * Make a GraphQL request to AniList API with rate limiting handling
   * Handles rate limits (90 req/min) and automatic retry with delay
   * @param query - The GraphQL query string
   * @param variables - The query variables
   * @returns The response body
   */
  private async makeGraphQLRequest<T = any>(
    query: string,
    variables: Record<string, any>
  ): Promise<T> {
    // Check if we need to wait due to rate limiting
    if (this.rateLimitRemaining <= 1 && this.rateLimitReset) {
      const now = Math.floor(Date.now() / 1000)
      const waitTime = this.rateLimitReset - now

      if (waitTime > 0) {
        logger.warning('AniList', `Rate limit reached, waiting ${waitTime}s`)
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000))
      }
    }

    try {
      const response = await got.post(this.apiUrl, {
        json: {
          query,
          variables,
        },
        responseType: 'json',
        timeout: {
          request: 10000,
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      })

      // Update rate limit info from response headers
      const remainingHeader = response.headers['X-RateLimit-Remaining']
      const resetHeader = response.headers['X-RateLimit-Reset']

      if (remainingHeader) {
        this.rateLimitRemaining = parseInt(remainingHeader as string, 10)
      }

      if (resetHeader) {
        this.rateLimitReset = parseInt(resetHeader as string, 10)
      }

      return response.body as T
    } catch (error: any) {
      // Handle 429 Too Many Requests
      if (error.response?.statusCode === 429) {
        const retryAfter = error.response.headers['retry-after']
        const waitTime = retryAfter ? parseInt(retryAfter as string, 10) : 60

        logger.warning('AniList', `Rate limit exceeded (429), retrying after ${waitTime}s`)

        // Wait and retry once
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000))

        // Recursive retry (only once)
        return this.makeGraphQLRequest<T>(query, variables)
      }

      throw error
    }
  }

  /**
   * Search for an anime by name using GraphQL query
   * @param search - The anime title to search for
   * @returns The AniList media object or null if not found
   */
  async searchAnime(search: string, year?: number | null): Promise<AniListMedia | null> {
    try {
      const query = `
        query ($search: String) {
          Media(search: $search, type: ANIME) {
            id
            startDate {
              year
              month
              day
            }
            endDate {
              year
              month
              day
            }
            title {
              romaji
              english
              userPreferred
            }
            episodes
            seasonYear
            season
            format
          }
        }
      `

      const variables = {
        search,
        year: year || null
      }

      logger.debug('AniList', `Searching for anime: "${search}"`)

      const data = await this.makeGraphQLRequest<AniListSearchResponse>(query, variables)

      await Utility.wait(200) // Small delay to avoid hitting rate limits

      if (data.data?.Media) {
        const media = data.data.Media

        // Convert startDate to UTC ISO string for easy comparisons
        let startDateUtc: string | null = null
        if (media.startDate?.year && media.startDate?.month) {
          const { year, month, day } = media.startDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            startDateUtc = dateTime.toISODate()
          }
        }

        // Convert startDate to UTC ISO string for easy comparisons
        let endDateUtc: string | null = null
        if (media.endDate?.year && media.endDate?.month) {
          const { year, month, day } = media.endDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            endDateUtc = dateTime.toISODate()
          }
        }

        const result: AniListMedia = {
          ...media,
          startDateUtc,
          endDateUtc,
        }

        return result
      }

      logger.warning('AniList', `No anime found for: "${search}"`)
      return null
    } catch (error: any) {
      // Handle 404 - anime not found
      if (error.response?.statusCode === 404) {
        logger.warning('AniList', `Anime not found (404): "${search}"`)
        return null
      }

      // Handle other HTTP errors (except 429 which is handled in makeGraphQLRequest)
      if (error.response?.statusCode && error.response.statusCode !== 429) {
        logger.error(
          'AniList',
          `HTTP error ${error.response.statusCode} searching anime "${search}"`,
          error
        )
        return null
      }

      // Handle network or other errors
      logger.error('AniList', `Error searching anime "${search}"`, error)
      throw new Error(
        `Failed to search anime on AniList: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Search for an anime by AniList ID using GraphQL query
   * @param id - The AniList anime ID
   * @returns The AniList media object or null if not found
   */
  async getMediaById(id: number): Promise<AniListMedia | null> {
    try {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            startDate {
              year
              month
              day
            }
            endDate {
              year
              month
              day
            }
            title {
              romaji
              english
              userPreferred
            }
            episodes
            seasonYear
            season
            format
          }
        }
      `

      const variables = {
        id
      }

      logger.debug('AniList', `Searching for anime by ID: ${id}`)

      const data = await this.makeGraphQLRequest<AniListSearchResponse>(query, variables)

      await Utility.wait(200) // Small delay to avoid hitting rate limits

      if (data.data?.Media) {
        const media = data.data.Media

        // Convert startDate to UTC ISO string for easy comparisons
        let startDateUtc: string | null = null
        if (media.startDate?.year && media.startDate?.month) {
          const { year, month, day } = media.startDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            startDateUtc = dateTime.toISODate()
          }
        }

        // Convert endDate to UTC ISO string for easy comparisons
        let endDateUtc: string | null = null
        if (media.endDate?.year && media.endDate?.month) {
          const { year, month, day } = media.endDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            endDateUtc = dateTime.toISODate()
          }
        }

        const result: AniListMedia = {
          ...media,
          startDateUtc,
          endDateUtc,
        }

        return result
      }

      logger.warning('AniList', `No anime found for ID: ${id}`)
      return null
    } catch (error: any) {
      // Handle 404 - anime not found
      if (error.response?.statusCode === 404) {
        logger.warning('AniList', `Anime not found (404) for ID: ${id}`)
        return null
      }

      // Handle other HTTP errors (except 429 which is handled in makeGraphQLRequest)
      if (error.response?.statusCode && error.response.statusCode !== 429) {
        logger.error(
          'AniList',
          `HTTP error ${error.response.statusCode} searching anime by ID ${id}`,
          error
        )
        return null
      }

      // Handle network or other errors
      logger.error('AniList', `Error searching anime by ID ${id}`, error)
      throw new Error(
        `Failed to search anime by ID on AniList: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async findSeasonPartTitles(
    title: string,
    start: DateTime,
    end: DateTime,
    format: keyof typeof AnimeTypeToAnilistType = 'ANIME'
  ): Promise<AniListMedia[]> {
    const query = `
        query ($search: String, $startDateGreater: FuzzyDateInt, $perPage: Int, $sort: [MediaSort], $endDateLesser: FuzzyDateInt, $formatIn: [MediaFormat]) {
          Page(perPage: $perPage) {
            media(search: $search, type: ANIME, startDate_greater: $startDateGreater, sort: $sort, endDate_lesser: $endDateLesser, format_in: $formatIn) {
              title {
                english
                romaji
                userPreferred
              }
              id
              startDate {
                day
                month
                year
              }
              endDate {
                day
                month
                year
              }
              episodes
              seasonYear
              season
              format
            }
            pageInfo {
              total
            }
          }
        }
      `

    // Create fuzzy date range by adding/subtracting 1 month 10 grace days
    const dateStartWithMargin = start.minus({ months:1, days: 10 })
    const dateEndWithMargin = end.plus({ months: 1, days: 10 })

    const variables = {
      search: title,
      formatIn: AnimeTypeToAnilistType[format],
      startDateGreater: parseInt(dateStartWithMargin.toFormat('yyyyLLdd')),
      endDateLesser: parseInt(dateEndWithMargin.toFormat('yyyyLLdd')),
      perPage: 15,
      sort: 'START_DATE',
    }

    const response = await this.makeGraphQLRequest<AniListSeasonPartsResponse>(query, variables)
    const { data } = response

    await Utility.wait(200) // Small delay to avoid hitting rate limits

    if (data?.Page.media.length === 0) {
      return []
    }

    return data.Page.media
      .map((media) => {
        // Convert startDate to UTC ISO string for easy comparisons
        let startDateUtc: string | null = null
        if (media.startDate?.year && media.startDate?.month) {
          const { year, month, day } = media.startDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            startDateUtc = dateTime.toISODate()
          }
        }
        // Convert startDate to UTC ISO string for easy comparisons
        let endDateUtc: string | null = null
        if (media.endDate?.year && media.endDate?.month) {
          const { year, month, day } = media.endDate
          const dateTime = DateTime.utc(year, month, day || 1)
          if (dateTime.isValid) {
            endDateUtc = dateTime.toISODate()
          }
        }

        const result: AniListMedia = {
          ...media,
          startDateUtc,
          endDateUtc,
        }

        return result
      })
      .filter(
        (media) => 
          media.startDateUtc !== null &&
          media.endDateUtc !== null &&
          DateTime.fromISO(media.startDateUtc!) >= dateStartWithMargin &&
          DateTime.fromISO(media.endDateUtc!) <= dateEndWithMargin
      )
  }
}

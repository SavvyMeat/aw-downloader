import Config from '#models/config'
import got, { Got } from 'got'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { logger } from '#services/logger_service'
import _ from 'lodash'
import QueryString from 'qs'

export enum FilterType {
  Anime = 0,
  Movie = 4,
  Ova = 1,
  Ona = 2,
}

export enum FilterDub {
  Sub = 0,
  Dub = 1,
}

export const AnimeTypeToFilterType: Record<string, FilterType[]> = {
  Anime: [FilterType.Anime, FilterType.Ona],
  Movie: [FilterType.Movie],
}

export interface AnimeSearchResult {
  id: number
  name: string
  jtitle: string
  link: string
  identifier: string
  anilistId: number
  dub: number // 0 = sub, 1 = dub
}

export interface AnimeSearchResponse {
  animes: AnimeSearchResult[]
  users: unknown[]
}

export interface FilterSearchResult {
  title: string
  jtitle: string
  identifier: string
  dub: FilterDub
  malId?: number | null
  anilistId?: number | null
}

export class AnimeworldService {
  private gotInstance: Got
  private cookieJar: CookieJar
  private baseUrlCache: string | null = null
  private isInitialized = false
  private csrfToken: string | null = null

  constructor() {
    // Create cookie jar
    this.cookieJar = new CookieJar()

    // Create got instance with cookie support and SSL disabled
    this.gotInstance = got.extend({
      cookieJar: this.cookieJar,
      https: {
        rejectUnauthorized: false, // Disable SSL verification
      },
      timeout: {
        request: 10000,
      },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    })
  }

  /**
   * Get the base URL for AnimeWorld from config
   */
  private async getBaseUrl(): Promise<string> {
    if (this.baseUrlCache) {
      return this.baseUrlCache
    }

    const baseUrl = await Config.get('animeworld_base_url')
    const url = (baseUrl || 'https://www.animeworld.ac').replace(/^\/+|\/+$/g, '')
    this.baseUrlCache = url
    return url
  }

  /**
   * Initialize session by visiting the base URL to get cookies and CSRF token
   */
  private async initializeSession(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      const baseUrl = await this.getBaseUrl()
      // Removed info log - too technical for users

      // Regex patterns to extract CSRF token and cookies
      const csrfTokenRegex = /<meta.*?id="csrf-token"\s*?content="(.*?)">/
      const cookieRegex = /document\.cookie\s*?=\s*?"(.+?)=(.+?)(\s*?;\s*?path=.+?)?"\s*?;/

      // Try up to 2 times to get the token
      for (let attempt = 0; attempt < 2; attempt++) {
        // Visit the homepage to get cookies and CSRF token
        const response = await this.gotInstance.get(baseUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          },
          followRedirect: true,
        })

        const html = response.body

        // Try to extract cookie from JavaScript
        const cookieMatch = html.match(cookieRegex)
        if (cookieMatch) {
          const cookieName = cookieMatch[1]
          const cookieValue = cookieMatch[2]
          await this.cookieJar.setCookie(`${cookieName}=${cookieValue}`, baseUrl)
          continue // Try again to get CSRF token
        }

        // Try to extract CSRF token
        const csrfMatch = html.match(csrfTokenRegex)
        if (csrfMatch) {
          this.csrfToken = csrfMatch[1]
          break
        }
      }

      this.isInitialized = true
      logger.debug('AnimeWorld', 'Sessione inizializzata')
    } catch (error) {
      logger.error('AnimeWorld', 'Errore durante l\'inizializzazione della sessione', error)
      throw error
    }
  }

  /**
   * Search for anime by keyword
   * @param keyword - The search keyword
   * @returns Array of anime search results
   */
  async searchAnime(keyword: string): Promise<AnimeSearchResult[]> {
    try {
      // Initialize session first (visit homepage to get cookies and CSRF token)
      await this.initializeSession()

      const baseUrl = await this.getBaseUrl()
      const searchUrl = `${baseUrl}/api/search/v2`

      // Build headers with CSRF token if available
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'Referer': baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
      }

      if (this.csrfToken) {
        headers['csrf-token'] = this.csrfToken
      }

      // Use POST with keyword as query parameter (URL encoded)
      const encodedKeyword = encodeURIComponent(keyword)
      const response = await this.gotInstance.post(`${searchUrl}?keyword=${encodedKeyword}`, {
        headers,
      })

      // Parse JSON manually
      const data = JSON.parse(response.body) as AnimeSearchResponse
      return data.animes || []
    } catch (error) {
      logger.error('AnimeWorld', `Errore durante la ricerca di "${keyword}"`, error)
      throw new Error(
        `Failed to search anime: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get the anime identifier (slug) from search result
   * This is what should be stored in the database instead of full URLs
   * @param link - The anime link from search results
   * @param identifier - The anime identifier from search results
   * @returns The identifier string to use with /play/
   */
  getAnimeIdentifier(link: string, identifier: string): string {
    // The identifier is the slug that goes after /play/
    // Format is: link.identifier (e.g., "one-piece.12345")
    return `${link}.${identifier}`
  }

  /**
   * Get the full play URL for an anime (for display/navigation purposes)
   * @param link - The anime link from search results
   * @param identifier - The anime identifier from search results
   * @returns Full play URL
   */
  async getPlayUrl(link: string, identifier: string): Promise<string> {
    const baseUrl = await this.getBaseUrl()
    const animeIdentifier = this.getAnimeIdentifier(link, identifier)
    return `${baseUrl}/play/${animeIdentifier}`
  }

  /**
   * Find best matching anime from search results and also find related parts
   * Tries to match by comparing titles
   * @param searchResults - Array of search results
   * @param targetTitle - The title to match against
   * @returns Array of matching animes (base + parts) ordered by ID, or null
   */
  findBestMatchWithParts(
    searchResults: AnimeSearchResult[],
    targetTitle: string
  ): AnimeSearchResult[] | null {
    const normalizeTitle = (title: string): string => {
      return (
        title
          .toLowerCase()
          // Remove language in parentheses e.g., "Title (ita)" or "Title (sub ita)"
          .replace(/(\(\S*\))/g, '')
          .replace(/[^a-z0-9\s]/gi, '')
          .trim()
      )
    }

    const normalizedTarget = normalizeTitle(targetTitle)

    const bestMatch = searchResults.find((anime) => {
      const animeName = normalizeTitle(anime.name)
      const normalizedJTitle = normalizeTitle(anime.jtitle)

      const partPattern = new RegExp(`^${normalizedTarget}$`, 'i')
      const match = animeName.match(partPattern) || normalizedJTitle.match(partPattern)

      return match
    })

    if (!bestMatch) {
      return null
    }

    const baseTitle = normalizeTitle(bestMatch.name)
    const baseJTitle = normalizeTitle(bestMatch.jtitle)

    const parts: AnimeSearchResult[] = [bestMatch]

    searchResults.forEach((anime) => {
      if (anime.id === bestMatch.id) return // Skip the base match

      const animeName = normalizeTitle(anime.name)
      const normalizedJTitle = normalizeTitle(anime.jtitle)

      // Check if this is a "Part X" of the base title
      // Patterns: "Title Part 2", "Title Part2", "Title Part 2 ita"
      // Note: "part" keyword is required to avoid matching sequential seasons
      const titlePattern = new RegExp(`^${baseTitle} \\s*(part[e]? (\\d+)).*`, 'i')
      const jtitlePattern = new RegExp(`^${baseJTitle} \\s*(part[e]? (\\d+)).*`, 'i')
      const match = animeName.match(titlePattern) || normalizedJTitle.match(jtitlePattern)

      if (match) {
        parts.push(anime)
      }
    })

    // Sort by ID to maintain correct order
    parts.sort((a, b) => a.id - b.id)

    logger.info('AnimeWorld', `Trovate ${parts.length} parti per "${bestMatch.name}"`)

    return parts
  }

  /**
   * Build full URL from identifier
   * @param identifier - The anime identifier (e.g., "one-piece-sub-ita")
   * @returns Full URL to the anime page
   */
  private async buildAnimeUrl(identifier: string): Promise<string> {
    const baseUrl = await this.getBaseUrl()
    const sanitizedIdentifier = identifier.replace(/^\/+|\/+$/g, '') // rimuove slash iniziali e finali dall'identifier
    return `${baseUrl}/play/${sanitizedIdentifier}`
  }

  /**
   * Get all episodes from multiple anime identifiers (for handling multi-part series)
   * @param animeIdentifiers - Array of anime identifiers (e.g., ["one-piece-sub-ita", "one-piece-2-sub-ita"])
   * @returns Object with episode number as key and episode URL as value, with episodes renumbered sequentially
   */
  async getEpisodesFromMultiplePages(animeIdentifiers: string[]): Promise<Record<number, string>> {
    const allEpisodes: Record<number, string> = {}
    let episodeOffset = 0

    for (const [index, identifier] of animeIdentifiers.entries()) {
      try {
        const episodes = await this.getEpisodesFromPage(identifier)
        const episodeNumbers = Object.keys(episodes)
          .map(Number)
          .sort((a, b) => a - b)

        logger.debug(
          'AnimeWorld',
          `Parte ${index + 1}: ${episodeNumbers.length} episodi`
        )

        // Renumber episodes with offset
        for (const episodeNum of episodeNumbers) {
          const newEpisodeNum = episodeOffset + episodeNum
          allEpisodes[newEpisodeNum] = episodes[episodeNum]
        }

        // Update offset for next part (max episode number of current part)
        if (episodeNumbers.length > 0) {
          episodeOffset += Math.max(...episodeNumbers)
        }
      } catch (error) {
        logger.error(
          'AnimeWorld',
          `Errore durante il recupero degli episodi dalla parte ${index + 1}`,
          error
        )
        // Continue with next identifier instead of failing completely
      }
    }

    logger.info(
      'AnimeWorld',
      `Recuperati ${Object.keys(allEpisodes).length} episodi totali`
    )
    return allEpisodes
  }

  /**
   * Get all episodes from the anime identifier
   * @param animeIdentifier - The anime identifier (e.g., "one-piece-sub-ita")
   * @returns Object with episode number as key and episode URL as value
   */
  async getEpisodesFromPage(animeIdentifier: string): Promise<Record<number, string>> {
    try {
      await this.initializeSession()

      const animePageUrl = await this.buildAnimeUrl(animeIdentifier)

      const response = await this.gotInstance.get(animePageUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      })

      const $ = cheerio.load(response.body)
      const episodes: Record<number, string> = {}

      // Find all episode links with selector 'ul.episodes li.episode [data-episode-num]'
      $('ul.episodes li.episode [data-episode-num]').each((_, element) => {
        const episodeNum = $(element).attr('data-episode-num')
        const episodeLink = $(element).attr('href')

        if (episodeNum && episodeLink) {
          const episodeNumber = parseInt(episodeNum, 10)
          if (!isNaN(episodeNumber)) {
            // Make absolute URL
            const baseUrl = new URL(animePageUrl).origin
            episodes[episodeNumber] = episodeLink.startsWith('http')
              ? episodeLink
              : `${baseUrl}${episodeLink}`
          }
        }
      })

      logger.debug('AnimeWorld', `Trovati ${Object.keys(episodes).length} episodi`)
      return episodes
    } catch (error) {
      logger.error('AnimeWorld', `Errore durante il recupero degli episodi`, error)
      throw new Error(
        `Failed to fetch episodes: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get download link for a specific episode
   * @param episodeUrl - The URL of the episode page
   * @returns The download URL
   */
  async getDownloadLinkFromEpisode(episodeUrl: string): Promise<string | null> {
    try {
      await this.initializeSession()

      const response = await this.gotInstance.get(episodeUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      })

      const $ = cheerio.load(response.body)

      // Find download link with selector '#download center a[download]'
      const downloadLink = $('#download center a[download]').attr('href')

      if (downloadLink) {
        return downloadLink
      }

      logger.warning('AnimeWorld', 'Link per il download non disponibile')
      return null
    } catch (error) {
      logger.error('AnimeWorld', `Errore durante il recupero del link per il download`, error)
      return null
    }
  }

  /**
   * Find and get download link for a specific episode number
   * @param animeIdentifiers - The anime identifier(s) (e.g., "one-piece-sub-ita") - can be string or array
   * @param episodeNumber - The episode number to find
   * @returns The download URL or null if not found
   */
  async findEpisodeDownloadLink(
    animeIdentifiers: string | string[],
    episodeNumber: number
  ): Promise<string | null> {
    try {
      // Normalize to array
      const identifiers = Array.isArray(animeIdentifiers) ? animeIdentifiers : [animeIdentifiers]

      // Get all episodes from all pages
      const episodes =
        identifiers.length > 1
          ? await this.getEpisodesFromMultiplePages(identifiers)
          : await this.getEpisodesFromPage(identifiers[0])

      // Check if the episode exists
      if (!episodes[episodeNumber]) {
        logger.warning('AnimeWorld', `Episodio ${episodeNumber} non disponibile`)
        return null
      }

      // Get the download link for the episode
      const downloadLink = await this.getDownloadLinkFromEpisode(episodes[episodeNumber])
      return downloadLink
    } catch (error) {
      logger.error('AnimeWorld', `Errore durante la ricerca dell'episodio ${episodeNumber}`, error)
      return null
    }
  }

  /**
   * Search anime using filter page
   * @param type - Type parameter (Anime = 0, Movie = 4)
   * @param dub - Dub parameter (Sub = 0, Dub = 1)
   * @param keyword - Search keyword
   * @returns Array of filter search results
   */
  async searchAnimeWithFilter({
    keyword,
    seasonYear,
    season,
    type = FilterType.Anime,
    dub = FilterDub.Sub,
  }: {
    keyword: string
    type?: FilterType | FilterType[]
    dub?: FilterDub
    seasonYear?: number | number[] | null
    season?: string | null
  }): Promise<FilterSearchResult[]> {
    // Validate keyword length
    if (!keyword || keyword.trim().length < 2) {
      throw new Error('Keyword must be at least 2 characters long. Received: ' + keyword)
    }

    try {
      await this.initializeSession()

      const baseUrl = await this.getBaseUrl()
      const filterUrl = `${baseUrl}/filter`

      // Build query parameters
      const params = QueryString.stringify(
        {
          type: _.castArray(type), // Enable type filter if seasonYear is provided
          dub: dub.toString(),
          sort: '0',
          keyword: keyword.trim(),
          season: season ? season : '',
          year: seasonYear ? _.castArray(seasonYear) : '',
        },
        { arrayFormat: 'repeat' }
      )

      const fullUrl = `${filterUrl}?${params.toString()}`

      const response = await this.gotInstance.get(fullUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      })

      const $ = cheerio.load(response.body)
      const results: FilterSearchResult[] = []

      // Find all items with selector '.film-list .item .name'
      $('.film-list .item .name').each((_, element) => {
        const title = $(element).text().trim()
        const jtitle = $(element).attr('data-jtitle')?.trim() || ''
        const href = $(element).attr('href')

        const serializedTitle = title.replace(/\(TV\)|\(ITA\)/g, ' ').trim()
        const serializedJTitle = jtitle.replace(/\(TV\)|\(ITA\)/g, ' ').trim()

        if (title && href) {
          results.push({
            title: serializedTitle,
            jtitle: serializedJTitle,
            identifier: href.trim().replace(/^\/play\//, ''),
            dub,
            malId: null,
            anilistId: null,
          })
        }
      })

      // Fetch MAL ID and AniList ID for each result
      for (const result of results) {
        try {
          const animePageUrl = await this.buildAnimeUrl(result.identifier)
          const pageResponse = await this.gotInstance.get(animePageUrl, {
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
          })

          const page$ = cheerio.load(pageResponse.body)

          // Try to find MAL ID and AniList ID from links or data attributes
          // Common patterns:
          // - Links like: https://myanimelist.net/anime/12345
          // - Links like: https://anilist.co/anime/12345
          // - Data attributes: data-mal-id, data-anilist-id

          // Search for MAL link
          const malLink = page$('a[href*="myanimelist.net/anime/"]').attr('href')
          if (malLink) {
            const malIdMatch = malLink.match(/\/anime\/(\d+)/)
            if (malIdMatch) {
              result.malId = parseInt(malIdMatch[1], 10)
            }
          }

          // Search for AniList link
          const anilistLink = page$('a[href*="anilist.co/anime/"]').attr('href')
          if (anilistLink) {
            const anilistIdMatch = anilistLink.match(/\/anime\/(\d+)/)
            if (anilistIdMatch) {
              result.anilistId = parseInt(anilistIdMatch[1], 10)
            }
          }

          // Try data attributes as fallback
          if (!result.malId) {
            const malIdAttr = page$('[data-mal-id]').attr('data-mal-id')
            if (malIdAttr) {
              result.malId = parseInt(malIdAttr, 10)
            }
          }

          if (!result.anilistId) {
            const anilistIdAttr = page$('[data-anilist-id]').attr('data-anilist-id')
            if (anilistIdAttr) {
              result.anilistId = parseInt(anilistIdAttr, 10)
            }
          }
        } catch (error) {
          logger.warning('AnimeWorld', `Impossibile recuperare gli ID per "${result.title}"`, error)
          // Continue with next result even if one fails
        }
      }

      logger.debug('AnimeWorld', `Trovati ${results.length} risultati con filtro`)
      return results
    } catch (error) {
      logger.error('AnimeWorld', 'Errore durante la ricerca con filtro', error)
      throw new Error(
        `Failed to search with filter: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

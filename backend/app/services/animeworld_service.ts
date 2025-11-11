import Config from '#models/config'
import got, { Got } from 'got'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import { logger } from '#services/logger_service'

export interface AnimeSearchResult {
  id: number
  name: string
  jtitle: string
  link: string
  identifier: string
  anilistId: number
}

export interface AnimeSearchResponse {
  animes: AnimeSearchResult[]
  users: unknown[]
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
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
    this.baseUrlCache = (baseUrl || 'https://www.animeworld.ac').replace(/^\/+|\/+$/g, '') 
    return this.baseUrlCache
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
      logger.info('AnimeWorld', `Inizializzazione sessione su ${baseUrl}`)
      
      // Regex patterns to extract CSRF token and cookies
      const csrfTokenRegex = /<meta.*?id="csrf-token"\s*?content="(.*?)">/
      const cookieRegex = /document\.cookie\s*?=\s*?"(.+?)=(.+?)(\s*?;\s*?path=.+?)?"\s*?;/
      
      // Try up to 2 times to get the token
      for (let attempt = 0; attempt < 2; attempt++) {
        // Visit the homepage to get cookies and CSRF token
        const response = await this.gotInstance.get(baseUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          },
          followRedirect: true,
        })
        
        const html = response.body
        
        // Try to extract cookie from JavaScript
        const cookieMatch = html.match(cookieRegex)
        if (cookieMatch) {
          const cookieName = cookieMatch[1]
          const cookieValue = cookieMatch[2]
          logger.debug('AnimeWorld', `Cookie trovato: ${cookieName}`)
          await this.cookieJar.setCookie(`${cookieName}=${cookieValue}`, baseUrl)
          continue // Try again to get CSRF token
        }
        
        // Try to extract CSRF token
        const csrfMatch = html.match(csrfTokenRegex)
        if (csrfMatch) {
          this.csrfToken = csrfMatch[1]
          logger.debug('AnimeWorld', `CSRF token trovato`)
          break
        }
      }
      
      this.isInitialized = true
      logger.success('AnimeWorld', 'Sessione inizializzata con successo')
    } catch (error) {
      logger.error('AnimeWorld', 'Errore inizializzazione sessione', error)
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
      }
      
      if (this.csrfToken) {
        headers['csrf-token'] = this.csrfToken
      }

      // Use POST with keyword as query parameter (URL encoded)
      const encodedKeyword = encodeURIComponent(keyword)
      logger.debug('AnimeWorld', `Chiamata API search: POST ${searchUrl}?keyword=${encodedKeyword}`, { headers })
      const response = await this.gotInstance.post(`${searchUrl}?keyword=${encodedKeyword}`, {
        headers,
      })
      console.log(response)
      logger.debug('AnimeWorld', `Risposta API search ricevuta (${response.statusCode})`)

      // Parse JSON manually
      const data = JSON.parse(response.body) as AnimeSearchResponse
      logger.info('AnimeWorld', `Trovati ${data.animes?.length || 0} risultati per "${keyword}"`)
      return data.animes || []
    } catch (error) {
      logger.error('AnimeWorld', `Errore ricerca anime "${keyword}"`, error)
      throw new Error(`Failed to search anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
  findBestMatchWithParts(searchResults: AnimeSearchResult[], targetTitle: string): AnimeSearchResult[] | null {
    const bestMatch = this.findBestMatch(searchResults, targetTitle)
    
    if (!bestMatch) {
      return null
    }

    // Find all related parts (e.g., "Sakamoto Days Part 2", "Sakamoto Days Part 3")
    const normalizeTitle = (title: string): string => {
      return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, '')
        .trim()
    }

    const baseTitle = normalizeTitle(bestMatch.name)
    const parts: AnimeSearchResult[] = [bestMatch]

    // Look for parts in search results
    searchResults.forEach((anime) => {
      if (anime.id === bestMatch.id) return // Skip the base match

      const animeName = normalizeTitle(anime.name)
      
      // Check if this is a "Part X" of the base title
      // Patterns: "Title Part 2", "Title Part2", "Title 2", etc.
      const partPattern = new RegExp(`^${baseTitle}\\s*(?:part)?\\s*(\\d+)$`, 'i')
      const match = animeName.match(partPattern)
      
      if (match) {
        parts.push(anime)
      }
    })

    // Sort by ID to maintain correct order
    parts.sort((a, b) => a.id - b.id)

    logger.info('AnimeWorld', `Trovate ${parts.length} parti per "${bestMatch.name}"`, { 
      parts: parts.map(p => ({ id: p.id, name: p.name }))
    })

    return parts
  }

  /**
   * Find best matching anime from search results
   * Tries to match by comparing titles
   * @param searchResults - Array of search results
   * @param targetTitle - The title to match against
   * @returns The best matching anime or null
   */
  findBestMatch(searchResults: AnimeSearchResult[], targetTitle: string): AnimeSearchResult | null {
    if (searchResults.length === 0) {
      return null
    }

    // If only one result, return it
    if (searchResults.length === 1) {
      return searchResults[0]
    }

    // Normalize title for comparison (lowercase, remove special chars)
    const normalizeTitle = (title: string): string => {
      return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, '')
        .trim()
    }

    const normalizedTarget = normalizeTitle(targetTitle)

    // Try exact match first
    let bestMatch = searchResults.find(
      (anime) =>
        normalizeTitle(anime.name) === normalizedTarget ||
        normalizeTitle(anime.jtitle) === normalizedTarget
    )

    if (bestMatch) {
      return bestMatch
    }

    // Try partial match (target contains anime name or vice versa)
    bestMatch = searchResults.find(
      (anime) =>
        normalizedTarget.includes(normalizeTitle(anime.name)) ||
        normalizeTitle(anime.name).includes(normalizedTarget) ||
        normalizedTarget.includes(normalizeTitle(anime.jtitle)) ||
        normalizeTitle(anime.jtitle).includes(normalizedTarget)
    )

    // If still no match, return the first result
    return bestMatch || searchResults[0]
  }

  /**
   * Build full URL from identifier
   * @param identifier - The anime identifier (e.g., "one-piece-sub-ita")
   * @returns Full URL to the anime page
   */
  private async buildAnimeUrl(identifier: string): Promise<string> {
    const baseUrl = await this.getBaseUrl()
    const sanitizedIdentifier = identifier.replace(/^\/+|\/+$/g, '') // rimuove slash iniziali e finali dall'identificatore
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
        const episodeNumbers = Object.keys(episodes).map(Number).sort((a, b) => a - b)

        logger.debug('AnimeWorld', `Parte ${index + 1}: ${episodeNumbers.length} episodi (offset: ${episodeOffset})`)

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
        logger.error('AnimeWorld', `Errore recupero episodi dalla parte ${index + 1}: ${identifier}`, error)
        // Continue with next identifier instead of failing completely
      }
    }

    logger.info('AnimeWorld', `Totale episodi da ${animeIdentifiers.length} parti: ${Object.keys(allEpisodes).length}`)
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
      logger.debug('AnimeWorld', `Recupero episodi da: ${animePageUrl}`)

      const response = await this.gotInstance.get(animePageUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
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

      logger.info('AnimeWorld', `Trovati ${Object.keys(episodes).length} episodi`)
      return episodes
    } catch (error) {
      logger.error('AnimeWorld', `Errore recupero episodi per ${animeIdentifier}`, error. message)
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

      logger.debug('AnimeWorld', `Recupero link download da: ${episodeUrl}`)

      const response = await this.gotInstance.get(episodeUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      })

      const $ = cheerio.load(response.body)

      // Find download link with selector '#download center a[download]'
      const downloadLink = $('#download center a[download]').attr('href')

      if (downloadLink) {
        logger.success('AnimeWorld', `Link download trovato`)
        return downloadLink
      }

      logger.warning('AnimeWorld', 'Nessun link download trovato')
      return null
    } catch (error) {
      logger.error('AnimeWorld', `Errore recupero link download da ${episodeUrl}`, error)
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
      const episodes = identifiers.length > 1 
        ? await this.getEpisodesFromMultiplePages(identifiers)
        : await this.getEpisodesFromPage(identifiers[0])

      // Check if the episode exists
      if (!episodes[episodeNumber]) {
        logger.warning('AnimeWorld', `Episodio ${episodeNumber} non trovato`)
        return null
      }

      // Get the download link for the episode
      const downloadLink = await this.getDownloadLinkFromEpisode(episodes[episodeNumber])
      return downloadLink
    } catch (error) {
      logger.error('AnimeWorld', `Errore ricerca episodio ${episodeNumber}`)
      return null
    }
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import Season from '#models/season'

export default class SeasonsController {
  /**
   * Get all seasons
   */
  async index({ response }: HttpContext) {
    try {
      const seasons = await Season.query().preload('series')
      return response.ok(seasons)
    } catch (error) {
      return response.badRequest({ message: 'Error fetching seasons', error: error.message })
    }
  }

  /**
   * Get seasons by series ID
   */
  async bySeries({ params, response }: HttpContext) {
    try {
      const seasons = await Season.query().where('series_id', params.seriesId)
      return response.ok(seasons)
    } catch (error) {
      return response.badRequest({ message: 'Error fetching seasons', error: error.message })
    }
  }

  /**
   * Get a single season by ID
   */
  async show({ params, response }: HttpContext) {
    try {
      const season = await Season.query()
        .where('id', params.id)
        .preload('series')
        .firstOrFail()
      return response.ok(season)
    } catch (error) {
      return response.notFound({ message: 'Season not found' })
    }
  }

  /**
   * Create a new season
   */
  async store({ request, response }: HttpContext) {
    try {
      const data = request.only(['seriesId', 'seasonNumber', 'title', 'totalEpisodes', 'status', 'releaseDate'])
      const season = await Season.create(data)
      return response.created(season)
    } catch (error) {
      return response.badRequest({ message: 'Error creating season', error: error.message })
    }
  }

  /**
   * Update a season
   */
  async update({ params, request, response }: HttpContext) {
    try {
      const season = await Season.findOrFail(params.id)
      const data = request.only([
        'seriesId',
        'seasonNumber',
        'title',
        'totalEpisodes',
        'status',
        'releaseDate',
        'downloadUrls',
        'missingEpisodes',
      ])
      season.merge(data)
      await season.save()
      return response.ok(season)
    } catch (error) {
      return response.badRequest({ message: 'Error updating season', error: error.message })
    }
  }

  /**
   * Update anime identifiers for a season
   * Identifiers are the slugs after /play/ (e.g., "one-piece.12345")
   */
  async updateDownloadUrls({ params, request, response }: HttpContext) {
    try {
      const season = await Season.findOrFail(params.id)
      const { downloadUrls } = request.only(['downloadUrls'])

      // downloadUrls should be an array of anime identifiers or a JSON string
      // If it's a string, try to parse it as JSON
      if (typeof downloadUrls === 'string') {
        try {
          season.downloadUrls = JSON.parse(downloadUrls)
        } catch {
          // If parsing fails, treat as empty
          season.downloadUrls = null
        }
      } else if (Array.isArray(downloadUrls)) {
        season.downloadUrls = downloadUrls
      } else {
        season.downloadUrls = null
      }

      await season.save()
      return response.ok(season)
    } catch (error) {
      return response.badRequest({
        message: 'Error updating download URLs',
        error: error.message,
      })
    }
  }

  /**
   * Delete a season
   */
  async destroy({ params, response }: HttpContext) {
    try {
      const season = await Season.findOrFail(params.id)
      await season.delete()
      return response.ok({ message: 'Season deleted successfully' })
    } catch (error) {
      return response.badRequest({ message: 'Error deleting season', error: error.message })
    }
  }
}
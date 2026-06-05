import type { HttpContext } from '@adonisjs/core/http'
import { getRadarrService } from '#services/radarr_service'

export default class RadarrController {
  /**
   * Get all tags from Radarr
   */
  async getTags({ response }: HttpContext) {
    try {
      const radarrService = getRadarrService()
      await radarrService.initialize()

      const tags = await radarrService.getTags()

      return response.json(tags)
    } catch (error) {
      return response.status(500).json({
        message: 'Failed to fetch tags from Radarr',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

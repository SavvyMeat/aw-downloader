import type { HttpContext } from '@adonisjs/core/http'
import { getSonarrService } from '#services/sonarr_service'

export default class SonarrController {
  /**
   * Get all tags from Sonarr
   */
  async getTags({ response }: HttpContext) {
    try {
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      
      const tags = await sonarrService.getTags()
      
      return response.json(tags)
    } catch (error) {
      return response.status(500).json({ 
        message: 'Failed to fetch tags from Sonarr',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Get all notifications from Sonarr
   */
  async getNotifications({ response }: HttpContext) {
    try {
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      
      const notifications = await sonarrService.getNotifications()
      
      return response.json(notifications)
    } catch (error) {
      return response.status(500).json({ 
        message: 'Failed to fetch notifications from Sonarr',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}

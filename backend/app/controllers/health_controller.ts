import { HttpContext } from '@adonisjs/core/http'
import { SonarrService } from '#services/sonarr_service'

export default class HealthController {
  /**
   * Check Sonarr connection health (with cache)
   */
  async checkSonarr({ response }: HttpContext) {
    const status = SonarrService.getHealthStatus()

    return response.json({
      healthy: status.healthy,
      lastCheck: status.lastCheck,
      cached: true,
    })
  }

  /**
   * Force a fresh health check
   */
  async forceSonarrCheck({ response }: HttpContext) {
    const healthy = await SonarrService.performHealthCheck()
    const status = SonarrService.getHealthStatus()

    return response.json({
      healthy: healthy,
      lastCheck: status.lastCheck,
      cached: false,
    })
  }

  /**
   * Get current health status without performing check
   */
  async getSonarrStatus({ response }: HttpContext) {
    const status = SonarrService.getHealthStatus()

    return response.json({
      healthy: status.healthy,
      lastCheck: status.lastCheck,
    })
  }
}

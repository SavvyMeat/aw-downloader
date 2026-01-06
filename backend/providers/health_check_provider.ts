import type { ApplicationService } from '@adonisjs/core/types'
import cron from 'node-cron'
import { SonarrService } from '#services/sonarr_service'
import { logger } from '#services/logger_service'

export default class HealthCheckProvider {
  private cronJob: cron.ScheduledTask | null = null

  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {
    if (this.app.getEnvironment() !== 'web') {
      return;
    }
    // Start cron job to check Sonarr health every minute
    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await SonarrService.performHealthCheck()
      } catch (error) {
        logger.error('HealthCheckProvider', 'Failed to perform health check', error)
      }
    })

    // Perform initial health check
    try {
      await SonarrService.performHealthCheck()
    } catch (error) {
      logger.error('HealthCheckProvider', 'Initial health check failed', error.message)
    }

  }

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {
    if (this.app.getEnvironment() !== 'web') {
      return;
    }
    if (this.cronJob) {
      this.cronJob.stop()
    }
  }
}

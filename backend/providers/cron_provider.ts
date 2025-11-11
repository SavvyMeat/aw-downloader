import type { ApplicationService } from '@adonisjs/core/types'
import cronHelper from '../app/helpers/cron_helper.js'

export default class CronProvider {
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
    if (this.app.getEnvironment() === 'web') {
        await cronHelper.initialize()
    }
  }

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {
    if (this.app.getEnvironment() === 'web') {
    // Stop all cron jobs
      cronHelper.stopAll()
    }
  }
}

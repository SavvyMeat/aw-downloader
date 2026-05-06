import type { ApplicationService } from '@adonisjs/core/types'
import fs from 'fs/promises'

export default class TmpCleanupProvider {
  constructor(protected app: ApplicationService) {}

  register() {}

  async boot() {}

  async start() {}

  /**
   * Clear tmp/downloads on startup to remove any leftover partial downloads
   */
  async ready() {
    if (this.app.getEnvironment() === 'web') {
      const tmpDir = this.app.tmpPath('downloads')
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      await fs.mkdir(tmpDir, { recursive: true }).catch(() => {})
    }
  }

  async shutdown() {}
}

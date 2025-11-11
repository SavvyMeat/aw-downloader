import type { HttpContext } from '@adonisjs/core/http'
import { logger, LogLevel } from '#services/logger_service'

export default class LogsController {
  /**
   * Get logs with optional filtering
   */
  async index({ request, response }: HttpContext) {
    try {
      const level = request.input('level') as LogLevel | undefined
      const category = request.input('category') as string | undefined
      const limit = request.input('limit', 100)
      const sinceTimestamp = request.input('since') as string | undefined

      const since = sinceTimestamp ? new Date(sinceTimestamp) : undefined

      const logs = logger.getLogs({
        level,
        category,
        limit,
        since,
      })

      return response.json({ logs })
    } catch (error) {
      return response.badRequest({
        message: 'Error fetching logs',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Get log statistics
   */
  async stats({ response }: HttpContext) {
    try {
      const stats = logger.getStats()
      return response.json(stats)
    } catch (error) {
      return response.badRequest({
        message: 'Error fetching log stats',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Clear all logs
   */
  async clear({ response }: HttpContext) {
    try {
      logger.clear()
      return response.json({ message: 'Logs cleared successfully' })
    } catch (error) {
      return response.badRequest({
        message: 'Error clearing logs',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
}

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  category: string
  message: string
  details?: any
}

class LoggerService {
  private logs: LogEntry[] = []
  private maxLogs = 500 // Keep last 500 logs in memory
  private logIdCounter = 0

  /**
   * Add a log entry
   */
  private addLog(level: LogLevel, category: string, message: string, details?: any): void {
    const log: LogEntry = {
      id: `log-${++this.logIdCounter}`,
      timestamp: new Date(),
      level,
      category,
      message,
      details,
    }

    this.logs.unshift(log) // Add to beginning

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }

    // Also log to console with appropriate method
    const consoleMessage = `[${category}] ${message}`
    switch (level) {
      case LogLevel.ERROR:
        console.error(consoleMessage, details || '')
        break
      case LogLevel.WARNING:
        console.warn(consoleMessage, details || '')
        break
      case LogLevel.DEBUG:
        console.debug(consoleMessage, details || '')
        break
      case LogLevel.SUCCESS:
      case LogLevel.INFO:
      default:
        console.log(consoleMessage, details || '')
        break
    }
  }

  /**
   * Log debug message
   */
  debug(category: string, message: string, details?: any): void {
    this.addLog(LogLevel.DEBUG, category, message, details)
  }

  /**
   * Log info message
   */
  info(category: string, message: string, details?: any): void {
    this.addLog(LogLevel.INFO, category, message, details)
  }

  /**
   * Log warning message
   */
  warning(category: string, message: string, details?: any): void {
    this.addLog(LogLevel.WARNING, category, message, details)
  }

  /**
   * Log error message
   */
  error(category: string, message: string, details?: any): void {
    this.addLog(LogLevel.ERROR, category, message, details)
  }

  /**
   * Log success message
   */
  success(category: string, message: string, details?: any): void {
    this.addLog(LogLevel.SUCCESS, category, message, details)
  }

  /**
   * Get logs with optional filtering
   */
  getLogs(options?: {
    level?: LogLevel
    category?: string
    limit?: number
    since?: Date
  }): LogEntry[] {
    let filtered = [...this.logs]

    if (options?.level) {
      filtered = filtered.filter((log) => log.level === options.level)
    }

    if (options?.category) {
      filtered = filtered.filter((log) => log.category === options.category)
    }

    if (options?.since) {
      filtered = filtered.filter((log) => log.timestamp >= options.since!)
    }

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit)
    }

    return filtered
  }

  /**
   * Get log statistics
   */
  getStats(): {
    total: number
    byLevel: Record<LogLevel, number>
    byCategory: Record<string, number>
  } {
    const byLevel: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.WARNING]: 0,
      [LogLevel.ERROR]: 0,
      [LogLevel.SUCCESS]: 0,
    }

    const byCategory: Record<string, number> = {}

    this.logs.forEach((log) => {
      byLevel[log.level]++
      byCategory[log.category] = (byCategory[log.category] || 0) + 1
    })

    return {
      total: this.logs.length,
      byLevel,
      byCategory,
    }
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = []
    this.logIdCounter = 0
  }
}

// Export singleton instance
export const logger = new LoggerService()

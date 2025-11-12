import { DateTime } from 'luxon'
import { logger } from '#services/logger_service'

export interface TaskStatus {
  lastRunAt: DateTime | null
  nextRunAt: DateTime | null
  status: 'idle' | 'running' | 'success' | 'error'
  lastError: string | null
}

export abstract class BaseTask {
  abstract id: string
  abstract name: string
  abstract description: string
  abstract defaultIntervalMinutes: number
  
  intervalMinutes: number

  protected taskStatus: TaskStatus = {
    lastRunAt: null,
    nextRunAt: null,
    status: 'idle',
    lastError: null,
  }

  constructor(intervalMinutes?: number) {
    this.intervalMinutes = intervalMinutes ?? 60 // Default to 60 minutes if not provided
    // Set initial nextRunAt to now + interval
    this.taskStatus.nextRunAt = DateTime.now().plus({ minutes: this.intervalMinutes })
  }

  /**
   * Public getters for task status
   */
  get status(): 'idle' | 'running' | 'success' | 'error' {
    return this.taskStatus.status
  }

  get lastRunAt(): DateTime | null {
    return this.taskStatus.lastRunAt
  }

  get nextRunAt(): DateTime | null {
    return this.taskStatus.nextRunAt
  }

  get lastError(): string | null {
    return this.taskStatus.lastError
  }

  /**
   * Execute the task
   */
  abstract execute(): Promise<void>

  /**
   * Get task status
   */
  getStatus(): TaskStatus {
    return { ...this.taskStatus }
  }

  /**
   * Update task status
   */
  protected updateStatus(status: Partial<TaskStatus>): void {
    this.taskStatus = { ...this.taskStatus, ...status }
  }

  /**
   * Run the task with error handling
   */
  async run(): Promise<void> {
    logger.info('Task', `Executing task: ${this.name}`)

    try {
      this.updateStatus({
        status: 'running',
        lastRunAt: DateTime.now(),
      })

      await this.execute()

      this.updateStatus({
        status: 'success',
        lastError: null,
        nextRunAt: DateTime.now().plus({ minutes: this.intervalMinutes }),
      })

      logger.success('Task', `Task ${this.name} completed successfully`)
    } catch (error) {
      logger.error('Task', `Error executing task ${this.name}`, error)

      this.updateStatus({
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Unknown error',
        nextRunAt: DateTime.now().plus({ minutes: this.intervalMinutes }),
      })
    }
  }

  /**
   * Set next run time
   */
  setNextRunAt(nextRunAt: DateTime): void {
    this.updateStatus({ nextRunAt })
  }
}

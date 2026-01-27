import cron from 'node-cron'
import Config from '#models/config'
import { BaseTask, UpdateMetadataTask, FetchWantedTask } from '../tasks/index.js'
import { DateTime } from 'luxon'

interface TaskInstance {
  id: string
  name: string
  description: string
  intervalMinutes: number
  cronExpression: string
  schedule: cron.ScheduledTask | null
  task: BaseTask
}

/**
 * CronHelper - Helper class to manage cron jobs in memory
 */
class CronHelper {
  private tasks: Map<string, TaskInstance> = new Map()

  /**
   * Initialize all tasks
   */
  async initialize() {
    // Get intervals from config or use defaults
    let metadataInterval = 120
    let wantedInterval = 30

    try {
      metadataInterval = parseInt(await Config.get('updatemetadata_interval') || '120')
      wantedInterval = parseInt(await Config.get('fetchwanted_interval') || '30')
    } catch (error) {
      // Config table might not exist yet (during migrations)
      console.log('Using default task intervals (config not available)')
    }

    // Create task instances
    const updateMetadataTask = new UpdateMetadataTask(metadataInterval)
    const fetchWantedTask = new FetchWantedTask(wantedInterval)

    // Register tasks
    await this.registerTask(updateMetadataTask)
    await this.registerTask(fetchWantedTask)
    
    console.log(`Initialized ${this.tasks.size} cron jobs`)
  }

  /**
   * Register and schedule a task
   */
  private async registerTask(task: BaseTask) {
    const cronExpression = this.minutesToCron(task.intervalMinutes)
    
    const taskInstance: TaskInstance = {
      id: task.id,
      name: task.name,
      description: task.description,
      intervalMinutes: task.intervalMinutes,
      cronExpression,
      schedule: null,
      task,
    }

    this.tasks.set(task.id, taskInstance)
    await this.scheduleTask(task.id)
  }

  /**
   * Convert minutes to cron expression
   */
  private minutesToCron(minutes: number): string {
    if (minutes < 60) {
      return `*/${minutes} * * * *`
    }
    const hours = Math.floor(minutes / 60)
    if ( hours < 24 ) {
      return `0 */${hours} * * *`
    }
    const days = Math.floor(hours / 24)
    if ( days < 7 ) {
      return `0 0 */${days} * *`
    }
    return `0 0 2 * *`
  }

  /**
   * Schedule a task
   */
  private async scheduleTask(taskId: string) {
    const taskInstance = this.tasks.get(taskId)
    
    if (!taskInstance) return false

    // Stop existing schedule if any
    if (taskInstance.schedule) {
      taskInstance.schedule.stop()
    }

    try {
      const schedule = cron.schedule(taskInstance.cronExpression, async () => {
        await taskInstance.task.run()
      })

      taskInstance.schedule = schedule
      const nextRunAt = schedule.getNextRun()
      if ( nextRunAt ) {
        taskInstance.task.setNextRunAt( DateTime.fromJSDate( nextRunAt ) )
      }
      console.log(`Scheduled task ${taskId}: ${taskInstance.name} (${taskInstance.cronExpression})`)
      return true
    } catch (error) {
      console.error(`Error scheduling task ${taskId}:`, error)
      return false
    }
  }

  /**
   * Update task interval
   */
  async updateTaskInterval(taskId: string, intervalMinutes: number) {
    const taskInstance = this.tasks.get(taskId)
    if (!taskInstance) return false

    taskInstance.intervalMinutes = intervalMinutes
    taskInstance.task.intervalMinutes = intervalMinutes
    taskInstance.cronExpression = this.minutesToCron(intervalMinutes)

    // Save to config
    const configKey = `${taskId.replace('_', '')}_interval`
    await Config.set(configKey, intervalMinutes.toString())

    // Reschedule
    await this.scheduleTask(taskId)
    
    return true
  }

  /**
   * Get all tasks with their status
   */
  getAllTasks() {
    return Array.from(this.tasks.values()).map(taskInstance => ({
      id: taskInstance.id,
      name: taskInstance.name,
      description: taskInstance.description,
      intervalMinutes: taskInstance.intervalMinutes,
      cronExpression: taskInstance.cronExpression,
      status: taskInstance.task.status,
      lastRunAt: taskInstance.task.lastRunAt?.toISO() || null,
      nextRunAt: taskInstance.task.nextRunAt?.toISO() || null,
      lastError: taskInstance.task.lastError,
    }))
  }

  /**
   * Get a single task
   */
  getTask(taskId: string) {
    const taskInstance = this.tasks.get(taskId)
    if (!taskInstance) return undefined

    return {
      id: taskInstance.id,
      name: taskInstance.name,
      description: taskInstance.description,
      intervalMinutes: taskInstance.intervalMinutes,
      cronExpression: taskInstance.cronExpression,
      status: taskInstance.task.status,
      lastRunAt: taskInstance.task.lastRunAt?.toISO() || null,
      nextRunAt: taskInstance.task.nextRunAt?.toISO() || null,
      lastError: taskInstance.task.lastError,
    }
  }

  /**
   * Execute a task immediately
   */
  async executeTaskNow(taskId: string): Promise<boolean> {
    const taskInstance = this.tasks.get(taskId)
    if (!taskInstance) return false

    // Execute task asynchronously (don't wait for completion)
    taskInstance.task.run().catch((error) => {
      console.error(`Error executing task ${taskId} manually:`, error)
    })

    return true
  }

  /**
   * Stop all tasks (for shutdown)
   */
  stopAll() {
    for (const taskInstance of this.tasks.values()) {
      if (taskInstance.schedule) {
        taskInstance.schedule.stop()
      }
    }
    console.log('All cron jobs stopped')
  }
}

// Export singleton instance
export default new CronHelper()



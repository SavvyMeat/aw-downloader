import type { HttpContext } from '@adonisjs/core/http'
import cronHelper from '../helpers/cron_helper.js'

export default class TasksController {
  /**
   * Get all tasks
   */
  async index({ response }: HttpContext) {
    try {
      const tasks = cronHelper.getAllTasks()
      return response.ok(tasks)
    } catch (error) {
      return response.badRequest({ message: 'Error fetching tasks', error: error.message })
    }
  }

  /**
   * Get a single task by ID
   */
  async show({ params, response }: HttpContext) {
    try {
      const task = cronHelper.getTask(params.id)
      if (!task) {
        return response.notFound({ message: 'Task not found' })
      }
      return response.ok(task)
    } catch (error) {
      return response.notFound({ message: 'Task not found' })
    }
  }

  /**
   * Update task interval
   */
  async updateInterval({ params, request, response }: HttpContext) {
    try {
      const { intervalMinutes } = request.only(['intervalMinutes'])
      
      if (!intervalMinutes || intervalMinutes < 1) {
        return response.badRequest({ message: 'Invalid interval value' })
      }

      const success = await cronHelper.updateTaskInterval(params.id, intervalMinutes)
      
      if (!success) {
        return response.notFound({ message: 'Task not found' })
      }

      const task = cronHelper.getTask(params.id)
      return response.ok(task)
    } catch (error) {
      return response.badRequest({ message: 'Error updating task interval', error: error.message })
    }
  }

  /**
   * Execute a task immediately
   */
  async execute({ params, response }: HttpContext) {
    try {
      const success = await cronHelper.executeTaskNow(params.id)
      
      if (!success) {
        return response.notFound({ message: 'Task not found' })
      }

      const task = cronHelper.getTask(params.id)
      return response.ok({ message: 'Task execution started', task })
    } catch (error) {
      return response.badRequest({ message: 'Error executing task', error: error.message })
    }
  }
}
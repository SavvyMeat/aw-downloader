import type { HttpContext } from '@adonisjs/core/http'
import Notification from '#models/notification'
import { logger } from '#services/logger_service'
import { getNotificationService } from '#services/notification_service'

export default class NotificationsController {
  /**
   * Get all Apprise notification URLs
   */
  async index({ response }: HttpContext) {
    try {
      const notifications = await Notification.query().orderBy('name', 'asc')
      return response.ok(notifications)
    } catch (error) {
      logger.error('AppriseNotificationsController', 'Errore durante il recupero delle notifiche', error)
      return response.internalServerError({
        message: 'Error fetching notifications',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Create a new notification URL
   */
  async store({ request, response }: HttpContext) {
    try {
      const data = request.only(['name', 'url', 'enabled', 'events'])

      if (!data.name || !data.url) {
        return response.badRequest({
          message: 'Name and URL are required',
        })
      }

      if (!data.events || !Array.isArray(data.events) || data.events.length === 0) {
        return response.badRequest({
          message: 'At least one event must be selected',
        })
      }

      if (data.name) {
        data.name = data.name.trim()

        const existingNotification = await Notification.query().where('name', data.name).first()

        if (existingNotification) {
          return response.badRequest({
            message: 'A notification with this name already exists',
          })
        }
      }

      const notification = await Notification.create({
        name: data.name,
        url: data.url,
        enabled: data.enabled ?? true,
        events: data.events ?? [],
      })

      logger.debug('NotificationsController', `Notifica creata: ${notification.name}`)
      return response.created(notification)
    } catch (error) {
      logger.error('AppriseNotificationsController', 'Errore durante la creazione della notifica', error)
      return response.internalServerError({
        message: 'Error creating notification',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Update a notification URL
   */
  async update({ params, request, response }: HttpContext) {
    try {
      const notification = await Notification.find(params.id)

      if (!notification) {
        return response.notFound({
          message: 'Notification not found',
        })
      }

      const data = request.only(['name', 'url', 'enabled', 'events'])

      if (data.name) {
        data.name = data.name.trim()

        if (data.name != notification.name) {
          const existingNotification = await Notification.query()
            .where('name', data.name)
            .whereNot('id', notification.id)
            .first()

          if (existingNotification) {
            return response.badRequest({
              message: 'A notification with this name already exists',
            })
          }
        }
      }

      notification.merge(data)
      await notification.save()

      logger.debug('NotificationsController', `Notifica aggiornata: ${notification.name}`)
      return response.ok(notification)
    } catch (error) {
      logger.error('NotificationsController', 'Errore durante l\'aggiornamento della notifica', error)
      return response.internalServerError({
        message: 'Error updating notification',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Delete a notification URL
   */
  async destroy({ params, response }: HttpContext) {
    try {
      const notification = await Notification.find(params.id)

      if (!notification) {
        return response.notFound({
          message: 'Notification not found',
        })
      }

      const name = notification.name
      await notification.delete()

      logger.debug('NotificationsController', `Notifica eliminata: ${name}`)
      return response.ok({
        message: 'Notification deleted successfully',
      })
    } catch (error) {
      logger.error('NotificationsController', 'Errore durante l\'eliminazione della notifica', error)
      return response.internalServerError({
        message: 'Error deleting notification',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Test a notification by sending a test message
   */
  async test({ params, response }: HttpContext) {
    try {
      const notification = await Notification.find(params.id)

      if (!notification) {
        return response.notFound({
          message: 'Notification not found',
        })
      }

      const notificationService = getNotificationService()
      const success = await notificationService.testNotification(notification.url)

      if (!success) {
        return response.badRequest({
          message: 'Failed to send test notification',
        })
      }

      logger.debug('NotificationsController', `Notifica di test inviata a: ${notification.name}`)

      return response.ok({
        message: 'Test notification sent successfully',
      })
    } catch (error) {
      logger.error('NotificationsController', 'Errore durante il test della notifica', error)
      return response.internalServerError({
        message: 'Error testing notification',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

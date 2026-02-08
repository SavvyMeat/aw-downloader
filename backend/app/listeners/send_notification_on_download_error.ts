import DownloadErrorEvent from '#events/download_error_event'
import Notification from '#models/notification'
import { getNotificationService } from '#services/notification_service'
import { logger } from '#services/logger_service'

export default class SendNotificationOnDownloadError {
  async handle(event: DownloadErrorEvent) {
    try {
      // Get all enabled notifications that listen to onDownloadError event
      const notifications = await Notification.query()
        .where('enabled', true)
        .exec()

      const filteredNotifications = notifications.filter((notification) =>
        notification.events.includes('onDownloadError')
      )

      if (filteredNotifications.length === 0) {
        return
      }

      const notificationService = getNotificationService()
      const title = 'Download Fallito'
      const message = `${event.data.seriesTitle} - S${event.data.seasonNumber.toString().padStart(2, '0')}E${event.data.episodeNumber.toString().padStart(2, '0')}\n${event.data.episodeTitle}\n\nErrore: ${event.data.error}`

      // Send notification to all filtered notification URLs
      for (const notification of filteredNotifications) {
        try {
          await notificationService.sendToUrl(notification.url, title, message, 'failure')
          logger.debug('NotificationListener', `Notifica di download fallito inviata a ${notification.name}`)
        } catch (error) {
          logger.error(
            'NotificationListener',
            `Impossibile inviare la notifica a ${notification.name}`,
            error
          )
        }
      }
    } catch (error) {
      logger.error('NotificationListener', 'Errore durante la gestione dell\'evento di download fallito', error)
    }
  }
}

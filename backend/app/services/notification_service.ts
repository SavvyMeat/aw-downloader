import { getSonarrService, SonarrNotificationConfig } from '#services/sonarr_service'
import { logger } from '#services/logger_service'
import axios from 'axios'

export class NotificationService {
  /**
   * Send download notification using enabled Sonarr notifications.
   * Fetches all notifications from Sonarr, filters for 'onDownload', and executes them.
   * 
   * @param seriesTitle - The title of the series
   * @param seasonNumber - The season number
   * @param episodeNumber - The episode number
   * @param episodeTitle - The title of the episode
   * @param quality - The quality profile (optional)
   */
  static async sendDownloadNotification(
    seriesTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    episodeTitle: string
  ): Promise<void> {
    try {
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      // Cast the result to our typed interface array
      const notifications = (await sonarrService.getNotifications()) as SonarrNotificationConfig[]

      const enabledNotifications = notifications.filter((n) => n.onDownload)

      if (enabledNotifications.length === 0) {
        logger.debug('NotificationService', 'No notifications enabled for download')
        return
      }

      logger.info(
        'NotificationService',
        `Sending download notifications to ${enabledNotifications.length} providers`
      )

      const message = `${seriesTitle} - ${seasonNumber}x${episodeNumber} - ${episodeTitle}`
      const title = 'Episode Downloaded'

      for (const notification of enabledNotifications) {
        await this.executeNotification(notification, title, message)
      }
    } catch (error) {
      logger.error('NotificationService', 'Failed to send download notifications', error)
    }
  }

  /**
   * Execute a single notification based on its implementation type.
   * Dispatches to the specific handler method based on the 'implementation' string.
   * 
   * @param notification - The notification configuration object
   * @param title - The notification title
   * @param message - The notification body message
   */
  private static async executeNotification(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const implementation = notification.implementation
    const name = notification.name

    try {
      switch (implementation) {
        case 'Discord':
          await this.sendDiscord(notification, title, message)
          break
        case 'Webhook':
          await this.sendWebhook(notification, title, message)
          break
        case 'Apprise':
          await this.sendApprise(notification, title, message)
          break
        default:
          logger.warning(
            'NotificationService',
            `Unsupported notification implementation: ${implementation} (${name})`
          )
      }
    } catch (error: any) {
      logger.error(
        'NotificationService',
        `Failed to send notification to ${name} (${implementation})`,
        error.message || error
      )
    }
  }

  /**
   * Helper to extract a field value from the notification configuration by name.
   * 
   * @param notification - The notification configuration
   * @param name - The name of the field to retrieve
   * @returns The value of the field or undefined if not found
   */
  private static getField<T>(notification: SonarrNotificationConfig, name: string): T | undefined {
    const field = notification.fields.find((f) => f.name === name)

    if (!field) return undefined

    switch (field.type) {
      case 'select':
        return field.selectOptions?.find((opt) => opt.value === field.value)?.name as T
      default:
        return field.value as T
    }
  }

  /**
   * Sends a notification via Discord Webhook.
   * Requires 'webHookUrl' field.
   */
  private static async sendDiscord(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const url = this.getField<string>(notification, 'webHookUrl')

    if (!url) {
      throw new Error('Missing webHookUrl for Discord')
    }

    await axios.post(url, {
      content: `**${title}**\n${message}`,
    })
  }

  /**
   * Sends a generic Webhook notification.
   * Requires 'url' field.
   */
  private static async sendWebhook(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const url = this.getField<string>(notification, 'url')
    const method = this.getField<string>(notification, 'method')

    if (!url) {
      throw new Error('Missing url for Webhook')
    }

    if (!method) {
      throw new Error('Missing method for Webhook')
    }

    await axios({
      method: method,
      url: url,
      data: {
        title,
        message,
        eventType: 'Download',
      },
    })
  }

  /**
   * Sends a notification via Apprise.
   * Requires 'serverUrl'. Optional 'configurationKey' and 'statelessUrls'.
   */
  private static async sendApprise(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const serverUrl = this.getField<string>(notification, 'serverUrl')
    const configurationKey = this.getField<string>(notification, 'configurationKey')
    const statelessUrls = this.getField<string>(notification, 'statelessUrls')

    if (!serverUrl) {
      throw new Error('Missing serverUrl for Apprise')
    }

    let endpoint = serverUrl.replace(/\/$/, '')

    // Construct endpoint based on configuration key
    // If key exists: /notify/key
    // If no key (stateless): /notify/
    if (configurationKey) {
      endpoint = `${endpoint}/notify/${configurationKey}`
    } else {
      endpoint = `${endpoint}/notify/`
    }

    const payload: any = {
      title: title,
      body: message,
    }

    if (statelessUrls) {
      payload.urls = statelessUrls
    }

    await axios.post(endpoint, payload)
  }
}
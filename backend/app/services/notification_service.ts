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
        case 'Telegram':
          await this.sendTelegram(notification, message)
          break
        case 'Discord':
          await this.sendDiscord(notification, title, message)
          break
        case 'Gotify':
          await this.sendGotify(notification, title, message)
          break
        case 'Slack':
          await this.sendSlack(notification, title, message)
          break
        case 'Webhook':
          await this.sendWebhook(notification, title, message)
          break
        case 'Apprise':
          await this.sendApprise(notification, title, message)
          break
        case 'Ntfy':
          await this.sendNtfy(notification, title, message)
          break
        case 'Pushover':
          await this.sendPushover(notification, title, message)
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
    return field ? (field.value as T) : undefined
  }

  /**
   * Sends a notification via Telegram.
   * Requires 'botToken' and 'chatId' fields.
   */
  private static async sendTelegram(notification: SonarrNotificationConfig, message: string): Promise<void> {
    const botToken = this.getField<string>(notification, 'botToken')
    const chatId = this.getField<string>(notification, 'chatId')

    if (!botToken || !chatId) {
      throw new Error('Missing botToken or chatId for Telegram')
    }

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
    })
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
   * Sends a notification via Gotify.
   * Requires 'server' and 'appToken' fields.
   */
  private static async sendGotify(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const url = this.getField<string>(notification, 'server')
    const appToken = this.getField<string>(notification, 'appToken')

    if (!url || !appToken) {
      throw new Error('Missing server or appToken for Gotify')
    }

    const cleanUrl = url.replace(/\/$/, '')
    await axios.post(`${cleanUrl}/message?token=${appToken}`, {
      title: title,
      message: message,
      priority: 5,
    })
  }

  /**
   * Sends a notification via Slack Webhook.
   * Requires 'webHookUrl' field.
   */
  private static async sendSlack(notification: SonarrNotificationConfig, title: string, message: string): Promise<void> {
    const url = this.getField<string>(notification, 'webHookUrl')

    if (!url) {
      throw new Error('Missing webHookUrl for Slack')
    }

    await axios.post(url, {
      text: `*${title}*\n${message}`,
    })
  }

  /**
   * Sends a generic Webhook notification.
   * Requires 'url' field. Optional 'method' (default POST).
   */
  private static async sendWebhook(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const url = this.getField<string>(notification, 'url')
    const method = this.getField<string>(notification, 'method') || 'POST'

    if (!url) {
      throw new Error('Missing url for Webhook')
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

  /**
   * Sends a notification via Ntfy.
   * Requires 'topics'. Optional 'serverUrl' (default ntfy.sh), 'priority', 'tags'.
   */
  private static async sendNtfy(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const serverUrl = this.getField<string>(notification, 'serverUrl') || 'https://ntfy.sh'
    const topics = this.getField<string | string[]>(notification, 'topics')
    const priority = this.getField<number>(notification, 'priority') || 3
    const tags = this.getField<string[]>(notification, 'tags')

    if (!topics) {
      throw new Error('Missing topics for Ntfy')
    }

    // Handle topics as array or comma-separated string
    const topicList = Array.isArray(topics) ? topics : String(topics).split(',')
    
    for (const topic of topicList) {
        if (!topic) continue
        
        const cleanUrl = serverUrl.replace(/\/$/, '')
        await axios.post(`${cleanUrl}/${topic.trim()}`, {
            topic: topic.trim(),
            title: title,
            message: message,
            priority: priority,
            tags: Array.isArray(tags) ? tags : [],
        })
    }
  }

  /**
   * Sends a notification via Pushover.
   * Requires 'apiKey' and 'userKey'. Optional 'priority', 'sound'.
   */
  private static async sendPushover(
    notification: SonarrNotificationConfig,
    title: string,
    message: string
  ): Promise<void> {
    const apiKey = this.getField<string>(notification, 'apiKey')
    const userKey = this.getField<string>(notification, 'userKey')
    const priority = this.getField<number>(notification, 'priority') || 0
    const sound = this.getField<string>(notification, 'sound')

    if (!apiKey || !userKey) {
      throw new Error('Missing apiKey or userKey for Pushover')
    }

    await axios.post('https://api.pushover.net/1/messages.json', {
      token: apiKey,
      user: userKey,
      title: title,
      message: message,
      priority: priority,
      sound: sound,
    })
  }
}
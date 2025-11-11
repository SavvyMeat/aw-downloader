import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Config extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: string

  @column()
  declare value: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  /**
   * Helper method to get config value by key
   */
  static async get(key: string): Promise<string | null> {
    const config = await Config.findBy('key', key)
    return config?.value || null
  }

  /**
   * Helper method to set config value
   */
  static async set(key: string, value: string): Promise<Config> {
    const config = await Config.firstOrNew({ key }, { value })
    config.value = value
    await config.save()
    return config
  }
}
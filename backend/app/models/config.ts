import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Config extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: string

  @column({
    prepare: (value: string[] | null) => {
      return JSON.stringify(value)
    },
    consume: (value: string | null) => {
      return JSON.parse(value || 'null')
    },
  })
  declare value: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  /**
   * Helper method to get config value by key
   * Returns the value parsed as JSON (supports boolean, number, string, etc.)
   */
  static async get<T = any>(key: string): Promise<T | null> {
    const config = await Config.findBy('key', key)
    if (!config?.value) {
      return null
    }
    return JSON.parse(config.value) as T
  }

  /**
   * Helper method to set config value
   * Automatically serializes the value as JSON
   */
  static async set(key: string, value: any): Promise<Config> {
    const jsonValue = JSON.stringify(value)
    const config = await Config.updateOrCreate({ key }, { value: jsonValue })
    return config
  }
}

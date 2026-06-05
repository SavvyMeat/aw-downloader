import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class RootFolder extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare serviceId: number

  @column()
  declare service: 'sonarr' | 'radarr'

  @column()
  declare path: string

  @column()
  declare mappedPath: string | null

  @column()
  declare accessible: boolean

  @column()
  declare freeSpace: number | null

  @column()
  declare totalSpace: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}

import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Series from './series.js'
import Season from './season.js'

export default class Episode extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare seriesId: number

  @column()
  declare seasonId: number

  @column()
  declare sonarrId: number

  @column()
  declare seasonNumber: number

  @column()
  declare episodeNumber: number

  @column()
  declare title: string

  @column()
  declare overview: string | null

  @column.dateTime()
  declare airDateUtc: DateTime | null

  @column()
  declare hasFile: boolean

  @column()
  declare monitored: boolean

  @column()
  declare airedStatus: 'aired' | 'not_aired'

  @column()
  declare diskStatus: 'missing' | 'downloaded'

  @belongsTo(() => Series)
  declare series: BelongsTo<typeof Series>

  @belongsTo(() => Season)
  declare season: BelongsTo<typeof Season>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
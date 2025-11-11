import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Season from './season.js'

export default class Series extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sonarrId: number | null

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare status: 'ongoing' | 'completed' | 'cancelled'

  @column()
  declare totalSeasons: number

  @column()
  declare posterUrl: string | null

  @column()
  declare posterPath: string | null

  @column.dateTime()
  declare posterDownloadedAt: DateTime | null

  @column()
  declare alternateTitles: string | null

  @column()
  declare genres: string | null

  @column()
  declare year: number | null

  @column()
  declare network: string | null

  @column()
  declare deleted: boolean

  @hasMany(() => Season)
  declare seasons: HasMany<typeof Season>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
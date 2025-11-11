import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Series from './series.js'
import Episode from './episode.js'

export default class Season extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare seriesId: number

  @column()
  declare seasonNumber: number

  @column()
  declare title: string

  @column()
  declare totalEpisodes: number

  @column()
  declare missingEpisodes: number

  /**
   * Array of anime identifiers (slugs after /play/) for AnimeWorld
   * Stored as JSON array. Example: ["one-piece.12345", "one-piece-part-2.12346"]
   * These identifiers are combined with the base URL from config to construct full URLs
   */
  @column({
    prepare: (value: string[] | null) => {
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return null
      }
      return JSON.stringify(value)
    },
    consume: (value: string | null) => {
      if (!value || value === 'null' || value === '[]') {
        return null
      }
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
      } catch {
        return null
      }
    },
  })
  declare downloadUrls: string[] | null

  @column()
  declare status: 'not_started' | 'downloading' | 'completed'

  @column()
  declare deleted: boolean

  @column.date()
  declare releaseDate: DateTime | null

  @belongsTo(() => Series)
  declare series: BelongsTo<typeof Series>

  @hasMany(() => Episode)
  declare episodes: HasMany<typeof Episode>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
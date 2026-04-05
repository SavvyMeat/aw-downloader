import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Film extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare radarrId: number

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare status: 'ongoing' | 'completed' | 'cancelled'

  @column()
  declare posterUrl: string | null

  @column()
  declare posterPath: string | null

  @column.dateTime()
  declare posterDownloadedAt: DateTime | null

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
  declare alternateTitles: string[] | null

  @column()
  declare genres: string | null

  @column()
  declare year: number | null

  @column()
  declare studio: string | null

  @column()
  declare preferredLanguage: string

  @column()
  declare animeworldUrl: string | null

  @column()
  declare deleted: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}

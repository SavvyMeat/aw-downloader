import type { HttpContext } from '@adonisjs/core/http'
import Series from '#models/series'
import Season from '#models/season'
import { MetadataSyncService } from '#services/metadata_sync_service'
import path from 'path'
import fs from 'fs/promises'

export default class SeriesController {
  /**
   * Get all series with pagination and search
   */
  async index({ request, response }: HttpContext) {
    try {
      const page = request.input('page', 1)
      const limit = request.input('limit', 10)
      const search = request.input('search', '')
      const sortBy = request.input('sortBy', 'title') // title, status, missingEpisodes
      const sortOrder = request.input('sortOrder', 'asc') // asc, desc

      const query = Series.query().preload('seasons')

      if (search) {
        query.where((builder) => {
          builder
            .where('title', 'like', `%${search}%`)
            .orWhere('description', 'like', `%${search}%`)
            .orWhere('alternate_titles', 'like', `%${search}%`)
        })
      }

      // Apply sorting based on sortBy parameter
      if (sortBy === 'title') {
        query.orderBy('title', sortOrder)
      } else if (sortBy === 'status') {
        query.orderBy('status', sortOrder)
      } else if (sortBy === 'missingEpisodes') {
        // For missing episodes, we need a subquery to count
        query.orderByRaw(
          `(SELECT COALESCE(SUM(missing_episodes), 0) FROM seasons WHERE series_id = series.id AND deleted = false) ${sortOrder.toUpperCase()}`
        )
      }

      const series = await query.paginate(page, limit)

      // Add statistics to each series
      const seriesWithStats = await Promise.all(
        series.map(async (s) => {
          // Get total missing episodes and count of non-deleted seasons
          const seasons = await Season.query().where('series_id', s.id).where('deleted', false)

          const totalMissingEpisodes = seasons.reduce(
            (sum, season) => sum + (season.missingEpisodes || 0),
            0
          )
          const totalSeasons = seasons.length

          // Check if any non-deleted season is missing download URL
          const seasonsWithoutUrl = seasons.filter((season) => {
            return !season.downloadUrls || season.downloadUrls.length === 0
          })

          return {
            ...s.serialize(),
            totalMissingEpisodes,
            totalSeasons,
            hasMissingDownloadUrls: seasonsWithoutUrl.length > 0,
          }
        })
      )

      return response.ok({
        data: seriesWithStats,
        meta: {
          ...series.getMeta(),
          hasMorePages: series.hasMorePages,
        },
      })
    } catch (error) {
      return response.badRequest({ message: 'Error fetching series', error: error.message })
    }
  }

  /**
   * Get a single series by ID
   */
  async show({ params, response }: HttpContext) {
    try {
      const series = await Series.query().where('id', params.id).firstOrFail()

      await series.load('seasons', (builder) => {
        if (series.absolute) {
          builder.where('season_number', 1).limit(1)
        } else {
          builder.where('deleted', false)
        }
        builder.orderBy('seasonNumber', 'asc')
      })

      await series
        .loadAggregate('seasons', (query) => {
          query.where('deleted', false)
          query.sum('missing_episodes').as('count_missing_episodes')
        })
        .loadAggregate('seasons', (query) => {
          query.where('deleted', false)
          query.sum('total_episodes').as('count_total_episodes')
        })

      return response.ok({
        ...series.toJSON(),
        countMissingEpisodes: series.$extras.count_missing_episodes as number,
        countTotalEpisodes: series.$extras.count_total_episodes,
      })
    } catch (error) {
      return response.notFound({ message: 'Series not found' })
    }
  }

  /**
   * Create a new series
   */
  async store({ request, response }: HttpContext) {
    try {
      const data = request.only(['title', 'description', 'status', 'totalSeasons', 'posterUrl'])
      const series = await Series.create(data)
      return response.created(series)
    } catch (error) {
      return response.badRequest({ message: 'Error creating series', error: error.message })
    }
  }

  /**
   * Update a series
   */
  async update({ params, request, response }: HttpContext) {
    try {
      const series = await Series.findOrFail(params.id)
      const data = request.only([
        'title',
        'description',
        'status',
        'totalSeasons',
        'posterUrl',
        'preferredLanguage',
        'absolute',
      ])
      series.merge(data)
      await series.save()
      return response.ok(series)
    } catch (error) {
      return response.badRequest({ message: 'Error updating series', error: error.message })
    }
  }

  /**
   * Delete a series
   */
  async destroy({ params, response }: HttpContext) {
    try {
      const series = await Series.findOrFail(params.id)
      await series.delete()
      return response.ok({ message: 'Series deleted successfully' })
    } catch (error) {
      return response.badRequest({ message: 'Error deleting series', error: error.message })
    }
  }

  /**
   * Get series poster image
   */
  async getPoster({ params, response }: HttpContext) {
    try {
      const series = await Series.findOrFail(params.id)

      if (!series.posterPath) {
        return response.notFound({ message: 'Poster not found for this series' })
      }

      const posterPath = path.join(process.cwd(), 'storage', 'posters', series.posterPath)

      // Check if file exists
      try {
        await fs.access(posterPath)
      } catch {
        return response.notFound({ message: 'Poster file not found' })
      }

      // Send the file
      return response.download(posterPath)
    } catch (error) {
      return response.notFound({ message: 'Series not found' })
    }
  }

  /**
   * Sync metadata for a single series
   */
  async syncMetadata({ params, response }: HttpContext) {
    try {
      const seriesId = params.id
      const { sonarrId } = await Series.findOrFail(seriesId)

      if (!sonarrId) {
        return response.badRequest({ message: 'Series does not have a Sonarr ID' })
      }

      const metadataSyncService = new MetadataSyncService()

      await metadataSyncService.syncSeries(sonarrId, true)

      return response.ok({
        message: 'Metadata synced successfully',
        seriesId,
      })
    } catch (error) {
      return response.badRequest({
        message: 'Error syncing metadata',
        error: error.message,
      })
    }
  }
}

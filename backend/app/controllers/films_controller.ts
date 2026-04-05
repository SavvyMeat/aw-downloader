import type { HttpContext } from '@adonisjs/core/http'
import Film from '#models/film'
import path from 'path'
import fs from 'fs/promises'

export default class FilmsController {
  /**
   * Get all films with pagination and search
   */
  async index({ request, response }: HttpContext) {
    try {
      const page = request.input('page', 1)
      const limit = request.input('limit', 10)
      const search = request.input('search', '')
      const sortBy = request.input('sortBy', 'title') // title, status, year
      const sortOrder = request.input('sortOrder', 'asc') // asc, desc
      const onlyMissingLinks = request.input('onlyMissingLinks', false)

      const query = Film.query()

      if (search) {
        query.where((builder) => {
          builder
            .where('title', 'like', `%${search}%`)
            .orWhere('description', 'like', `%${search}%`)
            .orWhere('alternate_titles', 'like', `%${search}%`)
        })
      }

      // Filter for films with missing AnimeWorld URL
      if (onlyMissingLinks === true || onlyMissingLinks === 'true') {
        query.where((builder) => {
          builder.whereNull('animeworld_url').orWhere('animeworld_url', '')
        })
      }

      // Apply sorting based on sortBy parameter
      if (sortBy === 'title') {
        query.orderBy('title', sortOrder)
      } else if (sortBy === 'status') {
        query.orderBy('status', sortOrder)
      } else if (sortBy === 'year') {
        query.orderBy('year', sortOrder)
      }

      const films = await query.paginate(page, limit)

      // Add statistics to each film
      const filmsArray = films.all()
      const filmsWithStats = filmsArray.map((f) => {
        return {
          ...f.serialize(),
          hasMissingAnimeWorldUrl: !f.animeworldUrl || f.animeworldUrl.length === 0,
        }
      })

      return response.ok({
        data: filmsWithStats,
        meta: {
          ...films.getMeta(),
          hasMorePages: films.hasMorePages,
        },
      })
    } catch (error) {
      return response.badRequest({ message: 'Error fetching films', error: error.message })
    }
  }

  /**
   * Get a single film by ID
   */
  async show({ params, response }: HttpContext) {
    try {
      const film = await Film.query().where('id', params.id).firstOrFail()

      return response.ok(film.toJSON())
    } catch (error) {
      return response.notFound({ message: 'Film not found' })
    }
  }

  /**
   * Create a new film
   */
  async store({ request, response }: HttpContext) {
    try {
      const data = request.only([
        'radarrId',
        'title',
        'description',
        'status',
        'posterUrl',
        'year',
        'studio',
        'preferredLanguage',
        'animeworldUrl',
      ])
      const film = await Film.create(data)
      return response.created(film)
    } catch (error) {
      return response.badRequest({ message: 'Error creating film', error: error.message })
    }
  }

  /**
   * Update a film
   */
  async update({ params, request, response }: HttpContext) {
    try {
      const film = await Film.findOrFail(params.id)
      const data = request.only([
        'title',
        'description',
        'status',
        'posterUrl',
        'preferredLanguage',
        'animeworldUrl',
        'year',
        'studio',
      ])
      film.merge(data)
      await film.save()
      return response.ok(film)
    } catch (error) {
      return response.badRequest({ message: 'Error updating film', error: error.message })
    }
  }

  /**
   * Delete a film
   */
  async destroy({ params, response }: HttpContext) {
    try {
      const film = await Film.findOrFail(params.id)
      await film.delete()
      return response.ok({ message: 'Film deleted successfully' })
    } catch (error) {
      return response.badRequest({ message: 'Error deleting film', error: error.message })
    }
  }

  /**
   * Get film poster image
   */
  async getPoster({ params, response }: HttpContext) {
    try {
      const film = await Film.findOrFail(params.id)

      if (!film.posterPath) {
        return response.notFound({ message: 'Poster not found for this film' })
      }

      const posterPath = path.join(process.cwd(), 'storage', 'posters', film.posterPath)

      // Check if file exists
      try {
        await fs.access(posterPath)
      } catch {
        return response.notFound({ message: 'Poster file not found' })
      }

      // Send the file
      return response.download(posterPath)
    } catch (error) {
      return response.notFound({ message: 'Film not found' })
    }
  }
}

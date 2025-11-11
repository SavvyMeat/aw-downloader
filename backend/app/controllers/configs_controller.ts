import type { HttpContext } from '@adonisjs/core/http'
import Config from '#models/config'
import { SonarrService } from '#services/sonarr_service'

export default class ConfigsController {
  /**
   * Get all configs
   */
  async index({ response }: HttpContext) {
    const configs = await Config.all()
    
    // Convert to key-value object for easier frontend consumption
    const configObject: Record<string, string> = {}
    configs.forEach((config) => {
      configObject[config.key] = config.value || ''
    })
    
    return response.json(configObject)
  }

  /**
   * Get a single config by key
   */
  async show({ params, response }: HttpContext) {
    const value = await Config.get(params.key)
    
    if (value === null) {
      return response.notFound({ message: 'Config not found' })
    }
    
    return response.json({ key: params.key, value })
  }

  /**
   * Create or update a config
   */
  async store({ request, response }: HttpContext) {
    const { key, value } = request.only(['key', 'value'])
    
    if (!key || value === undefined) {
      return response.badRequest({ message: 'Key and value are required' })
    }
    
    await Config.set(key, value)
    
    // Invalidate health cache if Sonarr config changed
    if (key === 'sonarr_url' || key === 'sonarr_token') {
      SonarrService.invalidateHealthCache()
    }
    
    return response.json({ key, value })
  }

  /**
   * Update multiple configs at once
   */
  async updateBatch({ request, response }: HttpContext) {
    const configs = request.body() as Record<string, string>
    
    for (const [key, value] of Object.entries(configs)) {
      await Config.set(key, value.toString())
    }
    
    return response.json({ message: 'Configs updated successfully', configs })
  }

  /**
   * Delete a config
   */
  async destroy({ params, response }: HttpContext) {
    const config = await Config.findBy('key', params.key)
    
    if (!config) {
      return response.notFound({ message: 'Config not found' })
    }
    
    await config.delete()
    
    return response.json({ message: 'Config deleted successfully' })
  }
}

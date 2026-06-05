import type { HttpContext } from '@adonisjs/core/http'
import RootFolder from '#models/root_folder'
import { getSonarrService } from '#services/sonarr_service'
import { getRadarrService } from '#services/radarr_service'
import { logger } from '#services/logger_service'

type ArrService = 'sonarr' | 'radarr'

export default class RootFoldersController {
  /**
   * Normalize the requested service, defaulting to Sonarr for backward compatibility
   */
  private resolveService(value: unknown): ArrService {
    return value === 'radarr' ? 'radarr' : 'sonarr'
  }

  /**
   * Get root folders, optionally filtered by service
   */
  async index({ request, response }: HttpContext) {
    try {
      const serviceParam = request.input('service')
      const query = RootFolder.query().orderBy('path', 'asc')
      if (serviceParam) {
        query.where('service', this.resolveService(serviceParam))
      }
      const rootFolders = await query
      return response.ok(rootFolders)
    } catch (error) {
      logger.error('RootFoldersController', 'Errore durante il recupero delle cartelle root', error)
      return response.internalServerError({
        message: 'Error fetching root folders',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Sync root folders from Sonarr or Radarr (replace the set for that service)
   */
  async sync({ request, response }: HttpContext) {
    const service = this.resolveService(request.input('service'))
    const label = service === 'radarr' ? 'Radarr' : 'Sonarr'

    try {
      const arrService = service === 'radarr' ? getRadarrService() : getSonarrService()

      // Initialize and test connection
      await arrService.initialize()
      const connectionOk = await arrService.testConnection()

      if (!connectionOk) {
        return response.badRequest({
          message: `Cannot connect to ${label}. Check your configuration.`,
        })
      }

      // Fetch root folders from the arr
      const arrRootFolders = await arrService.getRootFolders()

      let syncedCount = 0
      let updatedCount = 0

      const arrIds = arrRootFolders.map((folder) => folder.id)

      // Delete root folders (for this service) that are no longer in the arr
      const deletedFolders = await RootFolder.query()
        .where('service', service)
        .whereNotIn('service_id', arrIds.length > 0 ? arrIds : [-1])

      for (const folder of deletedFolders) {
        await folder.delete()
      }

      if (deletedFolders.length > 0) {
        logger.debug(
          'RootFoldersController',
          `Rimosse ${deletedFolders.length} cartelle root non più presenti in ${label}`
        )
      }

      // Sync each root folder
      for (const arrFolder of arrRootFolders) {
        const existingFolder = await RootFolder.query()
          .where('service', service)
          .where('service_id', arrFolder.id)
          .first()

        const folderData = {
          serviceId: arrFolder.id,
          service,
          path: arrFolder.path,
          accessible: arrFolder.accessible,
          freeSpace: arrFolder.freeSpace,
          totalSpace: arrFolder.totalSpace,
        }

        if (existingFolder) {
          // Update existing folder (preserve mappedPath)
          existingFolder.merge(folderData)
          await existingFolder.save()
          updatedCount++
        } else {
          await RootFolder.create(folderData)
          syncedCount++
        }
      }

      logger.info(
        'RootFoldersController',
        `Cartelle root ${label} sincronizzate: ${syncedCount} nuove, ${updatedCount} aggiornate`
      )

      const rootFolders = await RootFolder.query().where('service', service).orderBy('path', 'asc')

      return response.ok({
        message: `Sincronizzati ${syncedCount} nuovi e aggiornati ${updatedCount} root folders esistenti`,
        syncedCount,
        updatedCount,
        rootFolders,
      })
    } catch (error) {
      logger.error('RootFoldersController', 'Errore durante la sincronizzazione delle cartelle root', error)
      return response.internalServerError({
        message: `Error syncing root folders from ${label}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Update mapped path for a root folder
   */
  async updateMapping({ params, request, response }: HttpContext) {
    try {
      const rootFolder = await RootFolder.findOrFail(params.id)
      const { mappedPath } = request.only(['mappedPath'])

      rootFolder.mappedPath = mappedPath || null
      await rootFolder.save()

      return response.ok({
        message: 'Root folder mapping updated',
        rootFolder,
      })
    } catch (error) {
      logger.error('RootFoldersController', 'Errore durante l\'aggiornamento del mapping della cartella root', error)
      return response.internalServerError({
        message: 'Error updating root folder mapping',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

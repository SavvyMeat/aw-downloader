import type { HttpContext } from '@adonisjs/core/http'
import RootFolder from '#models/root_folder'
import { getSonarrService } from '#services/sonarr_service'
import { logger } from '#services/logger_service'

export default class RootFoldersController {
  /**
   * Get all root folders
   */
  async index({ response }: HttpContext) {
    try {
      const rootFolders = await RootFolder.query().orderBy('path', 'asc')
      return response.ok(rootFolders)
    } catch (error) {
      logger.error('RootFoldersController', 'Error fetching root folders', error)
      return response.internalServerError({
        message: 'Error fetching root folders',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Sync root folders from Sonarr
   */
  async sync({ response }: HttpContext) {
    try {
      const sonarrService = getSonarrService()
      
      // Initialize and test connection
      await sonarrService.initialize()
      const connectionOk = await sonarrService.testConnection()
      
      if (!connectionOk) {
        return response.badRequest({
          message: 'Cannot connect to Sonarr. Check your configuration.',
        })
      }

      // Fetch root folders from Sonarr
      const sonarrRootFolders = await sonarrService.getRootFolders()

      let syncedCount = 0
      let updatedCount = 0

      // Get all Sonarr IDs from the response
      const sonarrIds = sonarrRootFolders.map(folder => folder.id)

      // Delete root folders that are no longer in Sonarr
      if (sonarrIds.length > 0) {
        const deletedFolders = await RootFolder.query()
          .whereNotIn('sonarr_id', sonarrIds)
        
        for (const folder of deletedFolders) {
          await folder.delete()
        }
        
        if (deletedFolders.length > 0) {
          logger.info('RootFoldersController', `Removed ${deletedFolders.length} root folders no longer in Sonarr`)
        }
      }

      // Sync each root folder
      for (const sonarrFolder of sonarrRootFolders) {
        const existingFolder = await RootFolder.findBy('sonarr_id', sonarrFolder.id)

        const folderData = {
          sonarrId: sonarrFolder.id,
          path: sonarrFolder.path,
          accessible: sonarrFolder.accessible,
          freeSpace: sonarrFolder.freeSpace,
          totalSpace: sonarrFolder.totalSpace,
        }

        if (existingFolder) {
          // Update existing folder (preserve mappedPath)
          existingFolder.merge(folderData)
          await existingFolder.save()
          updatedCount++
        } else {
          // Create new folder
          await RootFolder.create(folderData)
          syncedCount++
        }
      }

      logger.success(
        'RootFoldersController',
        `Synced root folders: ${syncedCount} new, ${updatedCount} updated`
      )

      // Return updated list
      const rootFolders = await RootFolder.query().orderBy('path', 'asc')
      
      return response.ok({
        message: `Sincronizzati ${syncedCount} nuovi e aggiornati ${updatedCount} root folders esistenti`,
        syncedCount,
        updatedCount,
        rootFolders,
      })
    } catch (error) {
      logger.error('RootFoldersController', 'Error syncing root folders', error)
      return response.internalServerError({
        message: 'Error syncing root folders from Sonarr',
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

      logger.info('RootFoldersController', `Updated mapping for root folder ${rootFolder.id}`, {
        path: rootFolder.path,
        mappedPath: rootFolder.mappedPath,
      })

      return response.ok({
        message: 'Root folder mapping updated',
        rootFolder,
      })
    } catch (error) {
      logger.error('RootFoldersController', 'Error updating root folder mapping', error)
      return response.internalServerError({
        message: 'Error updating root folder mapping',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

import Config from '#models/config'
import Film from '#models/film'
import RootFolder from '#models/root_folder'
import Series from '#models/series'
import { getDownloadQueue } from '#services/download_queue'
import { logger } from '#services/logger_service'
import { getSonarrService } from '#services/sonarr_service'
import { getRadarrService } from '#services/radarr_service'
import DownloadSuccessEvent from '#events/download_success_event'
import DownloadErrorEvent from '#events/download_error_event'
import app from '@adonisjs/core/services/app'
import emitter from '@adonisjs/core/services/emitter'
import axios from 'axios'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import string from '@adonisjs/core/helpers/string'

export interface DownloadEpisodeParams {
  mediaType: 'episode'
  episodeId: number
  seriesId: number
  seasonId: number
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle: string
  downloadUrl: string
}

export interface DownloadFilmParams {
  mediaType: 'film'
  filmId: number
  radarrId: number
  filmTitle: string
  year: number | null
  downloadUrl: string
}

export type DownloadParams = DownloadEpisodeParams | DownloadFilmParams

interface DownloadChunk {
  chunkIndex: number
  start: number
  end: number
  filePath: string
}

export class DownloadEpisodesTask {
  private static cancelledDownloads: Set<string> = new Set()

  /**
   * Mark a download as cancelled
   */
  static cancelDownload(queueItemId: string): void {
    this.cancelledDownloads.add(queueItemId)
  }

  /**
   * Check if a download has been cancelled
   */
  private static isCancelled(queueItemId: string): boolean {
    return this.cancelledDownloads.has(queueItemId)
  }

  /**
   * Remove from cancelled list after cleanup
   */
  private static removeCancelled(queueItemId: string): void {
    this.cancelledDownloads.delete(queueItemId)
  }

  /**
   * Download a single episode using multiple worker threads
   */
  static async execute(params: DownloadParams, queueItemId: string): Promise<void> {
    const queue = getDownloadQueue()
    
    try {
      // Check if cancelled before starting
      if (this.isCancelled(queueItemId)) {
        this.removeCancelled(queueItemId)
        return
      }

      // Get max workers from config
      const maxWorkers = await this.getMaxWorkers()
      
      // Get file size and extension from URL
      const { extension: fileExtension, size: fileSize } = await this.getFileInfo(params.downloadUrl)
      
      // Check if cancelled after getting file size
      if (this.isCancelled(queueItemId)) {
        this.removeCancelled(queueItemId)
        return
      }
      
      // Create temp directory for chunks using AdonisJS storage
      const tempDir = app.tmpPath(`downloads/${queueItemId}`)
      await fs.mkdir(tempDir, { recursive: true })
      
      // Calculate chunk sizes
      const chunkSize = Math.ceil(fileSize / maxWorkers)
      const chunks: DownloadChunk[] = []
      
      for (let i = 0; i < maxWorkers; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize - 1, fileSize - 1)
        chunks.push({
          chunkIndex: i,
          start,
          end,
          filePath: path.join(tempDir, `chunk_${i}.tmp`),
        })
      }
      
      // Download chunks in parallel using workers
      await this.downloadChunks(params.downloadUrl, chunks, queue, queueItemId, fileSize)
      
      // Check if cancelled after download
      if (this.isCancelled(queueItemId)) {
        this.removeCancelled(queueItemId)
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        return
      }
      
      // Merge chunks
      const outputPath = app.tmpPath(
        'downloads',
        `${string.random(16)}.${fileExtension.replace(/^\.*/, '')}`
      )
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await this.mergeChunks(chunks, outputPath)
      
      // Clean up temp files
      await fs.rm(tempDir, { recursive: true, force: true })
      
      // Copy file to the *arr folder and trigger rescan/rename
      if (params.mediaType === 'film') {
        await this.copyToRadarrAndRescan(params, outputPath)
        // Clean up merged temp file
        await fs.rm(outputPath, { force: true }).catch(() => {})
        await this.renameMovieFile(params)
      } else {
        await this.copyToSonarrAndRescan(params, outputPath)
        // Clean up merged temp file
        await fs.rm(outputPath, { force: true }).catch(() => {})
        await this.renameEpisodeFile(params)
      }

      // Mark as completed
      queue.completeItem(queueItemId)

      // Emit download success event
      const successEvent = new DownloadSuccessEvent(
        params.mediaType === 'film'
          ? { mediaType: 'film', filmTitle: params.filmTitle, year: params.year }
          : {
              mediaType: 'episode',
              seriesTitle: params.seriesTitle,
              seasonNumber: params.seasonNumber,
              episodeNumber: params.episodeNumber,
              episodeTitle: params.episodeTitle,
            }
      )
      await emitter.emit(DownloadSuccessEvent, successEvent)

    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      queue.failItem(queueItemId, errorMessage)
      console.error(`Download failed for ${this.describeParams(params)}:`, error)

      // Emit download error event
      const errorEvent = new DownloadErrorEvent(
        params.mediaType === 'film'
          ? { mediaType: 'film', filmTitle: params.filmTitle, year: params.year, error: errorMessage }
          : {
              mediaType: 'episode',
              seriesTitle: params.seriesTitle,
              seasonNumber: params.seasonNumber,
              episodeNumber: params.episodeNumber,
              episodeTitle: params.episodeTitle,
              error: errorMessage,
            }
      )
      await emitter.emit(DownloadErrorEvent, errorEvent)
    }
  }

  /**
   * Human-readable label for logging
   */
  private static describeParams(params: DownloadParams): string {
    if (params.mediaType === 'film') {
      return `${params.filmTitle}${params.year ? ` (${params.year})` : ''}`
    }
    return `${params.seriesTitle} S${params.seasonNumber}E${params.episodeNumber}`
  }
  
  /**
   * Get max download workers from config
   */
  private static async getMaxWorkers(): Promise<number> {
    const value = await Config.get('download_max_workers')
    return value ? parseInt(value) : 4
  }
  
  /**
   * Get file extension from URL or Content-Disposition header
   */
  private static async getFileInfo(url: string): Promise<{extension: string, size: number}> {
    const response = await axios.head(url)

    const contentLength = response.headers['content-length']
    if (!contentLength) {
      throw new Error('Could not determine file size')
    }
    const fileSize = parseInt(contentLength)

    

    // Try to get filename from Content-Disposition header
    let extension;
    const contentDisposition = response.headers['content-disposition']
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        const filename = filenameMatch[1].replace(/['"]/g, '')
        const ext = path.extname(filename)
        if (ext) extension = ext
      }
    }
    
    // Fallback: extract from URL
    const urlPath = new URL(url).pathname
    extension = path.extname(urlPath)
    if (!extension) {
      throw new Error('Could not determine file extension')
    }
    

    
    // Default to .mkv if nothing found
    return {
      extension, 
      size: fileSize
    }
  }
  
  /**
   * Download chunks using parallel HTTP requests with Promise.all
   */
  private static async downloadChunks(
    url: string,
    chunks: DownloadChunk[],
    queue: ReturnType<typeof getDownloadQueue>,
    queueItemId: string,
    totalFileSize: number
  ): Promise<void> {
    const completedChunks = new Set<number>()
    let totalDownloaded = 0
    const startTime = Date.now()
    
    const promises = chunks.map(async (chunk) => {
      try {
        
        // Download chunk with byte range
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          headers: {
            Range: `bytes=${chunk.start}-${chunk.end}`,
          },
        })
        
        // Write chunk to file
        const writer = createWriteStream(chunk.filePath)
        
        // Track progress for this chunk
        let downloaded = 0
        const chunkSize = chunk.end - chunk.start + 1
        
        response.data.on('data', (data: Buffer) => {
          downloaded += data.length
          totalDownloaded += data.length
          
          // Calculate download speed (bytes per second)
          const elapsedSeconds = (Date.now() - startTime) / 1000
          const downloadSpeed = elapsedSeconds > 0 ? totalDownloaded / elapsedSeconds : 0
          
          const progress = (downloaded / chunkSize) * 100
          
          // Update progress every 10%
          if (progress % 10 < 1 || progress === 100) {
            completedChunks.add(chunk.chunkIndex)
            const overallProgress = Math.floor((totalDownloaded / totalFileSize) * 100)
            queue.updateProgress(queueItemId, overallProgress, downloadSpeed, totalFileSize)
          }
        })
        
        response.data.pipe(writer)
        
        // Wait for write to complete
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => {
            completedChunks.add(chunk.chunkIndex)
            resolve()
          })
          writer.on('error', reject)
        })
        
      } catch (error) {
        console.error(`Error downloading chunk ${chunk.chunkIndex}:`, error)
        throw error
      }
    })
    
    // Wait for all chunks to download
    await Promise.all(promises)
  }
  
  /**
   * Merge downloaded chunks into single file
   */
  private static async mergeChunks(chunks: DownloadChunk[], outputPath: string): Promise<void> {
    const writeStream = await fs.open(outputPath, 'w')
    
    try {
      for (const chunk of chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
        const chunkData = await fs.readFile(chunk.filePath)
        await writeStream.write(chunkData)
      }
    } finally {
      await writeStream.close()
    }
  }

  /**
   * Sanitize filename by removing invalid characters (based on Sonarr rules)
   * @param filename - The filename to sanitize
   * @returns Sanitized filename
   */
  private static sanitizeFilename(filename: string): string {
    let sanitized = filename
    
    // Replace specific characters following Sonarr's rules
    sanitized = sanitized.replace(/[\*:]/g, '-')  // * : => -
    sanitized = sanitized.replace(/\//g, '+')  // / => +
    sanitized = sanitized.replace(/\?/g, '!')  // ? => !
    
    // Remove these characters: | \ <> "
    sanitized = sanitized.replace(/[|\\<>"]/g, '')
    
    // Remove leading dots
    sanitized = sanitized.replace(/^\.+/, '')
    
    // Trim spaces
    sanitized = sanitized.trim()
    
    return sanitized
  }

  /**
   * Map an *arr path to a local path using root folder mappings for that service
   */
  private static async mapArrPathToLocal(
    arrPath: string,
    service: 'sonarr' | 'radarr'
  ): Promise<string> {
    // Get root folders with mappings for the given service
    const rootFolders = await RootFolder.query()
      .where('service', service)
      .whereNotNull('mapped_path')

    // Find the root folder that matches the start of the arr path
    for (const rootFolder of rootFolders) {
      if (arrPath.startsWith(rootFolder.path)) {
        // Replace the root folder path with the mapped path
        const relativePath = arrPath.substring(rootFolder.path.length)
        const localPath = path.join(rootFolder.mappedPath!, relativePath)
        return localPath
      }
    }

    // If no mapping found, return the original path
    return arrPath
  }

  /**
   * Copy downloaded file to Sonarr folder and trigger rescan
   */
  private static async copyToSonarrAndRescan(params: DownloadEpisodeParams, downloadedFilePath: string): Promise<void> {
    try {
      // Get series info from local database
      const series = await Series.query()
        .where('id', params.seriesId)
        .first()

      if (!series) {
        logger.error('DownloadTask', `Serie ${params.seriesTitle} non trovata`)
        return
      }

      if (!series.sonarrId) {
        logger.error('DownloadTask', `La serie ${params.seriesTitle} non ha un ID Sonarr associato`)
        return
      }

      // Get series details from Sonarr (with cache)
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      const sonarrSeries = await sonarrService.getSeriesById(series.sonarrId)

      if (!sonarrSeries.path) {
        logger.error('DownloadTask', `La serie ${params.seriesTitle} non ha un percorso configurato in Sonarr`)
        return
      }

      // Map Sonarr path to local path
      const localSeriesPath = await this.mapArrPathToLocal(sonarrSeries.path, 'sonarr')

      // Ensure the series folder exists
      await fs.mkdir(localSeriesPath, { recursive: true })

      // Format filename for Sonarr: "{Title} - S{season:00}E{episode:00}.ext"
      const seasonStr = params.seasonNumber.toString().padStart(2, '0')
      const episodeStr = params.episodeNumber.toString().padStart(2, '0')
      const extension = path.extname(downloadedFilePath)
      const sanitizedTitle = this.sanitizeFilename(params.seriesTitle)
      const sonarrFilename = `${sanitizedTitle} - S${seasonStr}E${episodeStr}${extension}`
      const destinationPath = path.join(localSeriesPath, sonarrFilename)

      logger.debug('DownloadTask', `Copia del file nella cartella Sonarr in corso...`)

      // Copy file to Sonarr folder
      await fs.copyFile(downloadedFilePath, destinationPath)

      logger.success('DownloadTask', `File copiato con successo`)

      // Trigger Sonarr rescan
      await sonarrService.rescanSeries(series.sonarrId)
      logger.success('DownloadTask', `Scansione della serie avviata`)

    } catch (error) {
      logger.error('DownloadTask', 'Impossibile copiare il file o avviare la scansione', error)
      // Don't throw - the download was successful, just the copy/rescan failed
    }
  }

  /**
   * Copy downloaded file to Sonarr folder and trigger rescan
   */
  private static async renameEpisodeFile({seriesTitle, episodeId, episodeNumber, seasonNumber}: DownloadEpisodeParams): Promise<void> {
    try {
      // Check if auto-rename is enabled
      const autoRename = await Config.get<boolean>('sonarr_auto_rename')
      if (autoRename) {

        const sonarrService = getSonarrService()
        await sonarrService.initialize()

        await new Promise(resolve => setTimeout(resolve, 2000));

        const episode = await sonarrService.getEpisode(episodeId)
        
        if (episode.episodeFileId) {
          await sonarrService.renameEpisodeFile(episode)
          logger.success('DownloadTask', `File rinominato: ${seriesTitle} S${seasonNumber}E${episodeNumber}`)
        } else {
          logger.warning('DownloadTask', `ID del file non trovato per ${seriesTitle} S${seasonNumber}E${episodeNumber}, impossibile rinominare`)
        }
      }

    } catch (error) {
      logger.error('DownloadTask', 'Impossibile rinominare il file dell\'episodio', error)
      // Don't throw - the download was successful, just the copy/rescan failed
    }
  }

  /**
   * Copy downloaded movie file to the Radarr folder and trigger a rescan
   */
  private static async copyToRadarrAndRescan(
    params: DownloadFilmParams,
    downloadedFilePath: string
  ): Promise<void> {
    try {
      const film = await Film.query().where('id', params.filmId).first()

      if (!film) {
        logger.error('DownloadTask', `Film ${params.filmTitle} non trovato`)
        return
      }

      if (!film.radarrId) {
        logger.error('DownloadTask', `Il film ${params.filmTitle} non ha un ID Radarr associato`)
        return
      }

      // Get movie details from Radarr
      const radarrService = getRadarrService()
      await radarrService.initialize()
      const movie = await radarrService.getMovieById(film.radarrId)

      if (!movie.path) {
        logger.error('DownloadTask', `Il film ${params.filmTitle} non ha un percorso configurato in Radarr`)
        return
      }

      // Map Radarr path to local path (root folder mappings are path-prefix based)
      const localMoviePath = await this.mapArrPathToLocal(movie.path, 'radarr')

      // Ensure the movie folder exists
      await fs.mkdir(localMoviePath, { recursive: true })

      // Format filename for Radarr: "{Title} ({year}).ext"
      const extension = path.extname(downloadedFilePath)
      const yearStr = params.year ? ` (${params.year})` : ''
      const sanitizedTitle = this.sanitizeFilename(params.filmTitle)
      const radarrFilename = `${sanitizedTitle}${yearStr}${extension}`
      const destinationPath = path.join(localMoviePath, radarrFilename)

      logger.debug('DownloadTask', `Copia del file nella cartella Radarr in corso...`)

      await fs.copyFile(downloadedFilePath, destinationPath)

      logger.success('DownloadTask', `File copiato con successo`)

      // Trigger Radarr rescan
      await radarrService.rescanMovie(film.radarrId)
      logger.success('DownloadTask', `Scansione del film avviata`)
    } catch (error) {
      logger.error('DownloadTask', 'Impossibile copiare il file o avviare la scansione', error)
      // Don't throw - the download was successful, just the copy/rescan failed
    }
  }

  /**
   * Trigger a rename for the movie file via Radarr (if auto-rename is enabled)
   */
  private static async renameMovieFile({ filmId, filmTitle }: DownloadFilmParams): Promise<void> {
    try {
      const autoRename = await Config.get<boolean>('radarr_auto_rename')
      if (!autoRename) {
        return
      }

      const film = await Film.query().where('id', filmId).first()
      if (!film?.radarrId) {
        return
      }

      const radarrService = getRadarrService()
      await radarrService.initialize()

      // Give Radarr a moment to register the imported file after the rescan
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const movie = await radarrService.getMovieById(film.radarrId)

      if (movie.movieFile?.id) {
        await radarrService.renameMovieFile(movie)
        logger.success('DownloadTask', `File rinominato: ${filmTitle}`)
      } else {
        logger.warning('DownloadTask', `ID del file non trovato per ${filmTitle}, impossibile rinominare`)
      }
    } catch (error) {
      logger.error('DownloadTask', 'Impossibile rinominare il file del film', error)
      // Don't throw - the download was successful, just the rename failed
    }
  }
}

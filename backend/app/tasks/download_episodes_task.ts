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
import {
  checkImportedFile,
  type CopiedFile,
  type ImportedFileCheck,
} from '../helpers/imported_file.js'
import { toArrLanguage, type ArrLanguage } from '../helpers/audio_language.js'
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
  /** Audio language code of the AnimeWorld entry the file comes from, if known */
  audioLanguage?: string | null
}

export interface DownloadFilmParams {
  mediaType: 'film'
  filmId: number
  radarrId: number
  filmTitle: string
  year: number | null
  downloadUrl: string
  /** Audio language code of the AnimeWorld entry the file comes from, if known */
  audioLanguage?: string | null
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
      
      // Copy file to the *arr folder, wait for the rescan, then update/rename the imported file
      if (params.mediaType === 'film') {
        const copied = await this.copyToRadarrAndRescan(params, outputPath)
        // Clean up merged temp file
        await fs.rm(outputPath, { force: true }).catch(() => {})
        if (copied) {
          await this.updateMovieFile(params, copied)
        }
      } else {
        const copied = await this.copyToSonarrAndRescan(params, outputPath)
        // Clean up merged temp file
        await fs.rm(outputPath, { force: true }).catch(() => {})
        if (copied) {
          await this.updateEpisodeFile(params, copied)
        }
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
   * Get the release group to set on imported files for a service, or null when disabled
   */
  private static async getReleaseGroup(service: 'sonarr' | 'radarr'): Promise<string | null> {
    const enabled = (await Config.get<boolean>(`${service}_release_group_enabled`)) ?? false
    if (!enabled) {
      return null
    }
    const releaseGroup = String((await Config.get<string>(`${service}_release_group`)) ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    return releaseGroup || 'AnimeWorld'
  }

  /**
   * Get the audio language to set on imported files for a service, or null when disabled or unknown
   */
  private static async getAudioLanguage(
    service: 'sonarr' | 'radarr',
    audioLanguage: string | null | undefined
  ): Promise<ArrLanguage | null> {
    const enabled = (await Config.get<boolean>(`${service}_audio_language_enabled`)) ?? false
    return enabled ? toArrLanguage(audioLanguage) : null
  }

  /**
   * Log why the file linked by Sonarr/Radarr after the rescan is not updated
   */
  private static logNotImportedFile(
    service: 'Sonarr' | 'Radarr',
    label: string,
    check: ImportedFileCheck
  ): void {
    const message =
      check === 'not_imported'
        ? `${service} non ha importato il file di ${label}, impossibile aggiornarlo`
        : `Il file di ${label} in ${service} non corrisponde a quello copiato, aggiornamento saltato`
    logger.warning('DownloadTask', message)
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
  private static async copyToSonarrAndRescan(
    params: DownloadEpisodeParams,
    downloadedFilePath: string
  ): Promise<CopiedFile | null> {
    try {
      // Get series info from local database
      const series = await Series.query()
        .where('id', params.seriesId)
        .first()

      if (!series) {
        logger.error('DownloadTask', `Serie ${params.seriesTitle} non trovata`)
        return null
      }

      if (!series.sonarrId) {
        logger.error('DownloadTask', `La serie ${params.seriesTitle} non ha un ID Sonarr associato`)
        return null
      }

      // Get series details from Sonarr (with cache)
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      const sonarrSeries = await sonarrService.getSeriesById(series.sonarrId)

      if (!sonarrSeries.path) {
        logger.error('DownloadTask', `La serie ${params.seriesTitle} non ha un percorso configurato in Sonarr`)
        return null
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

      // File linked to the episode before the copy (usually none), to recognize the new one.
      // Only used to verify the import afterwards: never block the copy because of it
      const previousFileId = await sonarrService
        .getEpisode(params.episodeId)
        .then((episode) => episode.episodeFileId ?? null)
        .catch((error) => {
          logger.warning('DownloadTask', "Impossibile leggere il file attuale dell'episodio", error)
          return null
        })

      logger.debug('DownloadTask', `Copia del file nella cartella Sonarr in corso...`)

      // Copy file to Sonarr folder
      await fs.copyFile(downloadedFilePath, destinationPath)
      const { size } = await fs.stat(destinationPath)

      logger.success('DownloadTask', `File copiato con successo`)

      // Trigger Sonarr rescan and wait for it: the scan imports the new file
      const commandId = await sonarrService.rescanSeries(series.sonarrId)
      logger.debug('DownloadTask', `Scansione della serie avviata, in attesa del termine...`)

      const status = await sonarrService.waitForCommand(commandId).catch((error) => {
        logger.error('DownloadTask', 'Impossibile verificare lo stato della scansione', error)
        return 'unknown'
      })
      if (status !== 'completed') {
        logger.warning('DownloadTask', `Scansione della serie non completata (status: ${status})`)
      }
      return { previousFileId, size }
    } catch (error) {
      logger.error('DownloadTask', 'Impossibile copiare il file o avviare la scansione', error)
      // Don't throw - the download was successful, just the copy/rescan failed
      return null
    }
  }

  /**
   * Once Sonarr has imported the file: set the release group and the audio language
   * (if enabled) and trigger the rename (if auto-rename is enabled)
   */
  private static async updateEpisodeFile(
    { seriesTitle, episodeId, episodeNumber, seasonNumber, audioLanguage }: DownloadEpisodeParams,
    copied: CopiedFile
  ): Promise<void> {
    const label = `${seriesTitle} S${seasonNumber}E${episodeNumber}`

    try {
      const sonarrService = getSonarrService()
      await sonarrService.initialize()

      const episode = await sonarrService.getEpisode(episodeId)
      const linkedFile = episode.episodeFileId
        ? await sonarrService.getEpisodeFile(episode.episodeFileId)
        : null

      const check = checkImportedFile(copied, {
        id: linkedFile?.id ?? null,
        size: linkedFile?.size ?? null,
      })
      if (check !== 'imported' || !episode.episodeFileId) {
        this.logNotImportedFile('Sonarr', label, check)
        return
      }

      // Set before renaming, so that the {Release Group} naming token and the
      // custom formats based on release group/language can use them
      const releaseGroup = await this.getReleaseGroup('sonarr')
      const language = await this.getAudioLanguage('sonarr', audioLanguage)
      if (releaseGroup || language) {
        try {
          await sonarrService.editEpisodeFile(episode.episodeFileId, {
            releaseGroup: releaseGroup ?? undefined,
            languages: language ? [language] : undefined,
          })
          logger.success('DownloadTask', `Informazioni ${label} aggiornate`)
        } catch (error) {
          logger.error('DownloadTask', `Impossibile aggiornare le informazioni di ${label}`, error)
        }
      }

      const autoRename = await Config.get<boolean>('sonarr_auto_rename')
      if (autoRename) {
        // Wait for the rename: a rescan running meanwhile (e.g. for the next download) would find
        // the file missing from its old path and re-import it as a new file, without the release group
        const commandId = await sonarrService.renameEpisodeFile(episode)
        const status = await sonarrService.waitForCommand(commandId).catch(() => 'unknown')
        if (status === 'completed') {
          logger.success('DownloadTask', `File rinominato: ${label}`)
        } else {
          logger.warning('DownloadTask', `Rinomina di ${label} non completata (status: ${status})`)
        }
      }
    } catch (error) {
      logger.error('DownloadTask', "Impossibile aggiornare il file dell'episodio", error)
      // Don't throw - the download was successful, just the update/rename failed
    }
  }

  /**
   * Copy downloaded movie file to the Radarr folder and trigger a rescan
   */
  private static async copyToRadarrAndRescan(
    params: DownloadFilmParams,
    downloadedFilePath: string
  ): Promise<CopiedFile | null> {
    try {
      const film = await Film.query().where('id', params.filmId).first()

      if (!film) {
        logger.error('DownloadTask', `Film ${params.filmTitle} non trovato`)
        return null
      }

      if (!film.radarrId) {
        logger.error('DownloadTask', `Il film ${params.filmTitle} non ha un ID Radarr associato`)
        return null
      }

      // Get movie details from Radarr
      const radarrService = getRadarrService()
      await radarrService.initialize()
      const movie = await radarrService.getMovieById(film.radarrId)

      if (!movie.path) {
        logger.error('DownloadTask', `Il film ${params.filmTitle} non ha un percorso configurato in Radarr`)
        return null
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
      const { size } = await fs.stat(destinationPath)

      logger.success('DownloadTask', `File copiato con successo`)

      // Trigger Radarr rescan and wait for it: the scan imports the new file
      const commandId = await radarrService.rescanMovie(film.radarrId)
      logger.debug('DownloadTask', `Scansione del film avviata, in attesa del termine...`)

      const status = await radarrService.waitForCommand(commandId).catch((error) => {
        logger.error('DownloadTask', 'Impossibile verificare lo stato della scansione', error)
        return 'unknown'
      })
      if (status !== 'completed') {
        logger.warning('DownloadTask', `Scansione del film non completata (status: ${status})`)
      }
      return { previousFileId: movie.movieFile?.id ?? null, size }
    } catch (error) {
      logger.error('DownloadTask', 'Impossibile copiare il file o avviare la scansione', error)
      // Don't throw - the download was successful, just the copy/rescan failed
      return null
    }
  }

  /**
   * Once Radarr has imported the file: set the release group and the audio language
   * (if enabled) and trigger the rename (if auto-rename is enabled)
   */
  private static async updateMovieFile(
    { filmId, filmTitle, audioLanguage }: DownloadFilmParams,
    copied: CopiedFile
  ): Promise<void> {
    try {
      const film = await Film.query().where('id', filmId).first()
      if (!film?.radarrId) {
        return
      }

      const radarrService = getRadarrService()
      await radarrService.initialize()

      const movie = await radarrService.getMovieById(film.radarrId)

      const check = checkImportedFile(copied, {
        id: movie.movieFile?.id ?? null,
        size: movie.movieFile?.size ?? null,
      })
      if (check !== 'imported' || !movie.movieFile?.id) {
        this.logNotImportedFile('Radarr', filmTitle, check)
        return
      }

      // Set before renaming, so that the {Release Group} naming token and the
      // custom formats based on release group/language can use them
      const releaseGroup = await this.getReleaseGroup('radarr')
      const language = await this.getAudioLanguage('radarr', audioLanguage)
      if (releaseGroup || language) {
        try {
          await radarrService.editMovieFile(movie.movieFile.id, {
            releaseGroup: releaseGroup ?? undefined,
            languages: language ? [language] : undefined,
          })
          logger.success('DownloadTask', `Informazioni ${filmTitle} aggiornate`)
        } catch (error) {
          logger.error(
            'DownloadTask',
            `Impossibile aggiornare le informazioni di ${filmTitle}`,
            error
          )
        }
      }

      const autoRename = await Config.get<boolean>('radarr_auto_rename')
      if (autoRename) {
        // Wait for the rename: a rescan running meanwhile would find the file missing from its
        // old path and re-import it as a new file, without the release group
        const commandId = await radarrService.renameMovieFile(movie)
        const status = await radarrService.waitForCommand(commandId).catch(() => 'unknown')
        if (status === 'completed') {
          logger.success('DownloadTask', `File rinominato: ${filmTitle}`)
        } else {
          logger.warning(
            'DownloadTask',
            `Rinomina di ${filmTitle} non completata (status: ${status})`
          )
        }
      }
    } catch (error) {
      logger.error('DownloadTask', 'Impossibile aggiornare il file del film', error)
      // Don't throw - the download was successful, just the update/rename failed
    }
  }
}

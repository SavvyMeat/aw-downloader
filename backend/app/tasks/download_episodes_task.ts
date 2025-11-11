import { getDownloadQueue } from '#services/download_queue'
import { getSonarrService } from '#services/sonarr_service'
import Config from '#models/config'
import RootFolder from '#models/root_folder'
import Series from '#models/series'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import axios from 'axios'
import app from '@adonisjs/core/services/app'
import { logger } from '#services/logger_service'

export interface DownloadEpisodeParams {
  episodeId: number
  seriesId: number
  seasonId: number
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle: string
  downloadUrl: string
}

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
  static async execute(params: DownloadEpisodeParams, queueItemId: string): Promise<void> {
    const queue = getDownloadQueue()
    
    console.log(`Starting download for: ${params.seriesTitle} S${params.seasonNumber}E${params.episodeNumber}`)
    console.log(`Download URL: ${params.downloadUrl}`)

    try {
      // Check if cancelled before starting
      if (this.isCancelled(queueItemId)) {
        console.log(`Download ${queueItemId} was cancelled before starting`)
        this.removeCancelled(queueItemId)
        return
      }

      // Get max workers from config
      const maxWorkers = await this.getMaxWorkers()
      
      // Get file size from HEAD request
      const fileSize = await this.getFileSize(params.downloadUrl)
      console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`)
      
      // Check if cancelled after getting file size
      if (this.isCancelled(queueItemId)) {
        console.log(`Download ${queueItemId} was cancelled`)
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
      console.log(`Downloading ${chunks.length} chunks with ${maxWorkers} workers...`)
      await this.downloadChunks(params.downloadUrl, chunks, queue, queueItemId, fileSize)
      
      // Check if cancelled after download
      if (this.isCancelled(queueItemId)) {
        console.log(`Download ${queueItemId} was cancelled after downloading chunks`)
        this.removeCancelled(queueItemId)
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        return
      }
      
      // Merge chunks
      console.log(`Merging chunks...`)
      const outputPath = app.makePath(
        'storage/downloads',
        `${params.seriesTitle}_S${params.seasonNumber}E${params.episodeNumber}.mkv`
      )
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await this.mergeChunks(chunks, outputPath)
      
      // Clean up temp files
      await fs.rm(tempDir, { recursive: true, force: true })
      
      console.log(`Download completed: ${params.seriesTitle} S${params.seasonNumber}E${params.episodeNumber}`)
      console.log(`Saved to: ${outputPath}`)

      // Copy file to Sonarr folder and trigger rescan
      await this.copyToSonarrAndRescan(params, outputPath)
      
      // Mark as completed
      queue.completeItem(queueItemId)
      
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      queue.failItem(queueItemId, errorMessage)
      console.error(`Download failed for ${params.seriesTitle} S${params.seasonNumber}E${params.episodeNumber}:`, error)
    }
  }
  
  /**
   * Get max download workers from config
   */
  private static async getMaxWorkers(): Promise<number> {
    const value = await Config.get('download_max_workers')
    return value ? parseInt(value) : 4
  }
  
  /**
   * Get file size from URL
   */
  private static async getFileSize(url: string): Promise<number> {
    const response = await axios.head(url)
    const contentLength = response.headers['content-length']
    if (!contentLength) {
      throw new Error('Could not determine file size')
    }
    return parseInt(contentLength)
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
        console.log(`Starting chunk ${chunk.chunkIndex}: bytes ${chunk.start}-${chunk.end}`)
        
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
            queue.updateProgress(queueItemId, overallProgress, downloadSpeed)
          }
        })
        
        response.data.pipe(writer)
        
        // Wait for write to complete
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => {
            console.log(`Completed chunk ${chunk.chunkIndex}`)
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
   * Map Sonarr path to local path using root folder mappings
   */
  private static async mapSonarrPathToLocal(sonarrPath: string): Promise<string> {
    // Get all root folders with mappings
    const rootFolders = await RootFolder.query().whereNotNull('mapped_path')

    // Find the root folder that matches the start of the sonarr path
    for (const rootFolder of rootFolders) {
      if (sonarrPath.startsWith(rootFolder.path)) {
        // Replace the root folder path with the mapped path
        const relativePath = sonarrPath.substring(rootFolder.path.length)
        const localPath = path.join(rootFolder.mappedPath!, relativePath)
        logger.info('DownloadTask', `Mapped Sonarr path ${sonarrPath} to local path ${localPath}`)
        return localPath
      }
    }

    // If no mapping found, return the original path
    logger.warning('DownloadTask', `No mapping found for Sonarr path ${sonarrPath}, using original path`)
    return sonarrPath
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
        logger.error('DownloadTask', `Series ${params.seriesId} not found`)
        return
      }

      if (!series.sonarrId) {
        logger.error('DownloadTask', `Series ${params.seriesId} has no Sonarr ID`)
        return
      }

      // Get series details from Sonarr (with cache)
      const sonarrService = getSonarrService()
      await sonarrService.initialize()
      const sonarrSeries = await sonarrService.getSeriesById(series.sonarrId)

      if (!sonarrSeries.path) {
        logger.error('DownloadTask', `Series ${series.sonarrId} has no path in Sonarr`)
        return
      }

      // Map Sonarr path to local path
      const localSeriesPath = await this.mapSonarrPathToLocal(sonarrSeries.path)

      // Ensure the series folder exists
      await fs.mkdir(localSeriesPath, { recursive: true })

      // Format filename for Sonarr: "{Title} - S{season:00}E{episode:00}.ext"
      const seasonStr = params.seasonNumber.toString().padStart(2, '0')
      const episodeStr = params.episodeNumber.toString().padStart(2, '0')
      const extension = path.extname(downloadedFilePath)
      const sonarrFilename = `${params.seriesTitle} - S${seasonStr}E${episodeStr}${extension}`
      const destinationPath = path.join(localSeriesPath, sonarrFilename)

      logger.info('DownloadTask', `Copying file to Sonarr folder: ${destinationPath}`)

      // Copy file to Sonarr folder
      await fs.copyFile(downloadedFilePath, destinationPath)

      logger.success('DownloadTask', `File copied successfully to ${destinationPath}`)

      // Trigger Sonarr rescan
      await sonarrService.rescanSeries(series.sonarrId)

      logger.success('DownloadTask', `Triggered Sonarr rescan for series ${series.sonarrId}`)

    } catch (error) {
      logger.error('DownloadTask', 'Failed to copy file to Sonarr and trigger rescan', error)
      // Don't throw - the download was successful, just the copy/rescan failed
    }
  }
}

import { EventEmitter } from 'events'
import app from '@adonisjs/core/services/app'
import fs from 'fs/promises'
import { logger } from './logger_service.js'
import Config from '#models/config'

export interface QueueItem {
  id: string
  seriesId: number
  seasonId: number
  episodeId: number
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle: string
  downloadUrl: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  downloadSpeed?: number // bytes per second
  addedAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
}

export class DownloadQueue extends EventEmitter {
  private queue: QueueItem[] = []
  private activeDownloads: Map<string, QueueItem> = new Map()
  private isProcessing: boolean = false

  constructor() {
    super()
  }

  /**
   * Get max concurrent downloads from config
   */
  private async getMaxConcurrentDownloads(): Promise<number> {
    const value = await Config.get('concurrent_downloads')
    return value ? parseInt(value) : 2
  }

  /**
   * Add an item to the queue
   */
  addToQueue(item: Omit<QueueItem, 'id' | 'status' | 'progress' | 'addedAt'>): string {
    const id = `${item.seriesId}-${item.seasonId}-${item.episodeId}-${Date.now()}`
    
    // Check if item already exists in queue or is downloading
    const exists = this.queue.some(
      (q) =>
        q.seriesId === item.seriesId &&
        q.seasonId === item.seasonId &&
        q.episodeId === item.episodeId &&
        (q.status === 'pending' || q.status === 'downloading')
    )

    if (exists) {
      throw new Error('Item already in queue')
    }

    const queueItem: QueueItem = {
      id,
      ...item,
      status: 'pending',
      progress: 0,
      addedAt: new Date(),
    }

    this.queue.push(queueItem)
    this.emit('item-added', queueItem)
    
    // Try to process the queue (will be skipped if already processing)
    this.processQueue()

    return id
  }

  /**
   * Remove an item from the queue
   */
  removeFromQueue(id: string): boolean {
    const index = this.queue.findIndex((item) => item.id === id)
    
    if (index === -1) {
      return false
    }

    const item = this.queue[index]
    
    // Can only remove pending items
    if (item.status !== 'pending') {
      return false
    }

    this.queue.splice(index, 1)
    this.emit('item-removed', item)
    
    return true
  }

  /**
   * Cancel an active download and remove partial files
   */
  async cancelDownload(id: string): Promise<boolean> {
    // Check if it's an active download
    const item = this.activeDownloads.get(id)
    
    if (item) {
      logger.warning('DownloadQueue', `Annullamento download in corso: ${item.seriesTitle} S${item.seasonNumber}E${item.episodeNumber}`)
      
      // Signal to the download task that it should stop
      const { DownloadEpisodesTask } = await import('../tasks/download_episodes_task.js')
      DownloadEpisodesTask.cancelDownload(id)
      
      // Mark as failed with cancellation message
      item.status = 'failed'
      item.error = 'Download cancelled by user'
      item.completedAt = new Date()
      this.activeDownloads.delete(id)
      this.emit('item-cancelled', item)
      
      // Remove partial download files
      try {
        const tempDir = app.tmpPath(`downloads/${id}`)
        
        await fs.rm(tempDir, { recursive: true, force: true })
        logger.success('DownloadQueue', `File temporanei rimossi per: ${item.seriesTitle} S${item.seasonNumber}E${item.episodeNumber}`)
      } catch (error) {
        logger.error('DownloadQueue', `Errore durante la rimozione dei file temporanei`, error)
      }
      
      // Continue processing queue
      this.processQueue()
      
      return true
    }
    
    // If not active, try to remove from pending queue
    const removed = this.removeFromQueue(id)
    if (removed) {
      logger.debug('DownloadQueue', `Elemento rimosso dalla coda in attesa: ${id}`)
    }
    return removed
  }

  /**
   * Get all items (queue + active + completed)
   */
  getAllItems(): QueueItem[] {
    return [
      ...Array.from(this.activeDownloads.values()),
      ...this.queue,
    ]
  }

  /**
   * Get only pending items
   */
  getPendingItems(): QueueItem[] {
    return this.queue.filter((item) => item.status === 'pending')
  }

  /**
   * Get active downloads
   */
  getActiveDownloads(): QueueItem[] {
    return Array.from(this.activeDownloads.values())
  }

  /**
   * Update progress for a downloading item
   */
  updateProgress(id: string, progress: number, downloadSpeed?: number): void {
    const item = this.activeDownloads.get(id)
    
    if (item) {
      item.progress = Math.min(100, Math.max(0, progress))
      if (downloadSpeed !== undefined) {
        item.downloadSpeed = downloadSpeed
      }
      this.emit('progress-update', item)
    }
  }

  /**
   * Mark an item as completed
   */
  completeItem(id: string): void {
    const item = this.activeDownloads.get(id)
    
    if (item) {
      item.status = 'completed'
      item.progress = 100
      item.completedAt = new Date()
      this.activeDownloads.delete(id)
      this.emit('item-completed', item)
      
      // Continue processing queue
      this.processQueue()
    }
  }

  /**
   * Mark an item as failed
   */
  failItem(id: string, error: string): void {
    const item = this.activeDownloads.get(id)
    
    if (item) {
      item.status = 'failed'
      item.error = error
      item.completedAt = new Date()
      this.activeDownloads.delete(id)
      this.emit('item-failed', item)
      
      // Continue processing queue
      this.processQueue()
    }
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return
    }
    
    this.isProcessing = true
    const maxConcurrentDownloads = await this.getMaxConcurrentDownloads()

    // Start new downloads if slots are available
    while (
      this.activeDownloads.size < maxConcurrentDownloads &&
      this.queue.length > 0
    ) {
      const item = this.queue.shift()
      
      if (item) {
        item.status = 'downloading'
        item.startedAt = new Date()
        this.activeDownloads.set(item.id, item)
        this.emit('item-started', item)
        
        // Start the download task (non-blocking)
        this.startDownload(item)
      }
    }

    // Mark as not processing so it can be called again
    this.isProcessing = false
  }

  /**
   * Start download for an item
   */
  private async startDownload(item: QueueItem): Promise<void> {
    try {
      // Dynamic import to avoid circular dependency
      const { DownloadEpisodesTask } = await import('../tasks/download_episodes_task.js')
      
      await DownloadEpisodesTask.execute(
        {
          episodeId: item.episodeId,
          seriesId: item.seriesId,
          seasonId: item.seasonId,
          seriesTitle: item.seriesTitle,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
          episodeTitle: item.episodeTitle,
          downloadUrl: item.downloadUrl,
        },
        item.id
      )
    } catch (error) {
      logger.error('DownloadQueue', `Errore durante il download di ${item.seriesTitle} S${item.seasonNumber}E${item.episodeNumber}`, error)
      // The task should have already marked it as failed, but just in case
      if (this.activeDownloads.has(item.id)) {
        this.failItem(item.id, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<{ maxWorkers: number; queueLength: number; activeDownloads: number }> {
    const maxConcurrentDownloads = await this.getMaxConcurrentDownloads()
    return {
      maxWorkers: maxConcurrentDownloads,
      queueLength: this.queue.length,
      activeDownloads: this.activeDownloads.size,
    }
  }

  /**
   * Clear completed and failed items
   */
  clearCompleted(): void {
    // Completed/failed items are not stored in memory by default
    // This method is here for future extensions
    this.emit('cleared')
  }
}

// Singleton instance
let queueInstance: DownloadQueue | null = null

export function getDownloadQueue(): DownloadQueue {
  if (!queueInstance) {
    queueInstance = new DownloadQueue()
  }
  return queueInstance
}

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
import { SpeedMeter } from '../helpers/speed_meter.js'
import app from '@adonisjs/core/services/app'
import emitter from '@adonisjs/core/services/emitter'
import { axios } from '#services/http_clients'
import type { AxiosError } from 'axios'
import fs, { type FileHandle } from 'fs/promises'
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

interface DownloadSegment {
  start: number
  end: number
}

const MB = 1024 * 1024

/**
 * Segments are file size / workers, so files up to workers × MAX_SEGMENT_SIZE take one
 * request per worker. Bigger files get more segments: a worker that is done takes the next one
 */
const MIN_SEGMENT_SIZE = 16 * MB
const MAX_SEGMENT_SIZE = 100 * MB

/** Smaller files are not a real episode or film (e.g. an error page or a broken upload) */
const MIN_FILE_SIZE = 5 * MB

/**
 * Content-Type values accepted for the file. Each pattern must match the whole value,
 * lowercase and without parameters (e.g. "video/mp4", not "video/mp4; charset=binary")
 */
const ALLOWED_CONTENT_TYPES = [/^video\/.+$/, /^application\/octet-stream$/, /^application\/mp4$/]

/** File extensions accepted for the file */
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mkv',
  'webm',
  'avi',
  'mov',
  'wmv',
  'flv',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'ogv',
  '3gp',
])

/** Time window of the download speed shown in the queue */
const SPEED_WINDOW_MS = 5000

/** Interval between progress and speed updates sent to the queue */
const PROGRESS_INTERVAL_MS = 1000

/** Attempts per segment before the whole download fails */
const MAX_SEGMENT_ATTEMPTS = 3

/** Wait before retrying after a 429 without Retry-After, multiplied by the attempt number */
const RATE_LIMIT_BASE_DELAY_MS = 5000

/** Longest wait accepted from a Retry-After header */
const RATE_LIMIT_MAX_DELAY_MS = 60_000

/** Suffix of the file while it is being downloaded */
const PARTIAL_SUFFIX = '.tmp'

/** Thrown inside the workers when the user cancels the download */
class DownloadCancelledError extends Error {}

/**
 * The file offered by the server does not look like a video: the download is skipped with
 * a warning in the log, without notifications, and retried at the next fetch of the wanted list
 */
class FileRejectedError extends Error {}

/** Byte counters shared by the workers of one download */
interface DownloadCounters {
  /** Bytes written and kept, for the progress */
  valid: number
  /** Bytes received from the network, also from failed attempts, for the speed */
  speed: SpeedMeter
}

/** The server answer can not be used at all: retrying the segment would not help */
class SegmentNotSupportedError extends Error {}

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
   * Download a single episode or film with parallel Range requests, then import it
   */
  static async execute(params: DownloadParams, queueItemId: string): Promise<void> {
    const queue = getDownloadQueue()
    let outputPath: string | null = null

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
      
      // Segments are written straight into one temp file, no merge step.
      // It keeps the ".tmp" suffix until every segment is downloaded and checked
      const finalPath = app.tmpPath('downloads', `${string.random(16)}.${fileExtension}`)
      outputPath = finalPath + PARTIAL_SUFFIX
      await fs.mkdir(path.dirname(outputPath), { recursive: true })

      const completed = await this.downloadSegments(
        params.downloadUrl,
        outputPath,
        fileSize,
        maxWorkers,
        queue,
        queueItemId
      )

      // Cancelled while downloading
      if (!completed) {
        this.removeCancelled(queueItemId)
        await fs.rm(outputPath, { force: true }).catch(() => {})
        return
      }

      // Complete: drop the ".tmp" suffix, the *arr copy reads the extension from the name
      await fs.rename(outputPath, finalPath)
      outputPath = finalPath

      // Cancelled right after the last segment: do not import it
      if (this.isCancelled(queueItemId)) {
        this.removeCancelled(queueItemId)
        await fs.rm(outputPath, { force: true }).catch(() => {})
        return
      }

      // From here on the file is copied and imported: it can no longer be cancelled
      queue.setPhase(queueItemId, 'importing')

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
      // Don't leave a partial file behind
      if (outputPath) {
        await fs.rm(outputPath, { force: true }).catch(() => {})
      }

      // Cancelled by the user while something failed: the queue already dropped the item,
      // so no failure to record and no notification
      if (this.isCancelled(queueItemId)) {
        this.removeCancelled(queueItemId)
        return
      }

      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      queue.failItem(queueItemId, errorMessage)

      // Not a video: only a warning, the episode stays missing and is retried later
      if (error instanceof FileRejectedError) {
        logger.warning(
          'DownloadTask',
          `File scartato per ${this.describeParams(params)}: ${errorMessage}. Verrà ritentato al prossimo controllo dei mancanti`
        )
        return
      }

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
   * Read size and extension of the file with a HEAD request, and reject it before downloading
   * when it does not look like a video: Content-Type not allowed, extension not allowed or too small
   */
  private static async getFileInfo(url: string): Promise<{ extension: string; size: number }> {
    // Uncompressed, so Content-Length is the size of the file itself
    const response = await axios.head(url, { headers: { 'Accept-Encoding': 'identity' } })

    const contentType = String(response.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    // No Content-Type says nothing about the file: a real error (with notification), not a
    // silent rejection, otherwise every download would be skipped without anyone noticing
    if (!contentType) {
      throw new Error('Il server non ha indicato il tipo del file (Content-Type assente)')
    }
    if (!this.isAllowedContentType(contentType)) {
      throw new FileRejectedError(`Content-Type non ammesso: ${contentType}`)
    }

    const fileSize = Number.parseInt(String(response.headers['content-length'] ?? ''))
    if (Number.isNaN(fileSize)) {
      throw new Error('Could not determine file size')
    }
    if (fileSize < MIN_FILE_SIZE) {
      throw new FileRejectedError(
        `file troppo piccolo (${this.formatBytes(fileSize)}, minimo ${this.formatBytes(MIN_FILE_SIZE)})`
      )
    }

    const extension = this.getExtension(url, response.headers['content-disposition'])
    if (!VIDEO_EXTENSIONS.has(extension)) {
      throw new FileRejectedError(
        `estensione non ammessa: ${extension ? `.${extension}` : 'assente'}`
      )
    }

    return { extension, size: fileSize }
  }

  /**
   * Content-Type allowlist: the value must match one of ALLOWED_CONTENT_TYPES
   */
  private static isAllowedContentType(contentType: string): boolean {
    return ALLOWED_CONTENT_TYPES.some((pattern) => pattern.test(contentType))
  }

  /**
   * Lowercase extension without the dot: from the Content-Disposition filename when present,
   * otherwise from the URL path. Empty string when neither has one
   */
  private static getExtension(url: string, contentDisposition: unknown): string {
    if (typeof contentDisposition === 'string') {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        const filename = filenameMatch[1].replace(/['"]/g, '')
        const extension = path.extname(filename)
        if (extension) {
          return extension.slice(1).toLowerCase()
        }
      }
    }
    return path.extname(new URL(url).pathname).slice(1).toLowerCase()
  }

  /**
   * Human-readable size for log messages
   */
  private static formatBytes(bytes: number): string {
    if (bytes >= MB) {
      return `${(bytes / MB).toFixed(1)} MB`
    }
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  /**
   * Split the file in segments of file size / workers, kept between MIN_SEGMENT_SIZE
   * and MAX_SEGMENT_SIZE. The last segment ends at the end of the file
   */
  private static splitIntoSegments(fileSize: number, workers: number): DownloadSegment[] {
    const segmentSize = Math.min(
      MAX_SEGMENT_SIZE,
      Math.max(MIN_SEGMENT_SIZE, Math.ceil(fileSize / Math.max(1, workers)))
    )
    const segments: DownloadSegment[] = []
    for (let start = 0; start < fileSize; start += segmentSize) {
      segments.push({ start, end: Math.min(start + segmentSize, fileSize) - 1 })
    }
    return segments
  }

  /**
   * How long to wait after a 429: the Retry-After header (seconds or HTTP date) when present,
   * otherwise a delay growing with the attempt number
   */
  private static rateLimitDelay(retryAfter: unknown, attempt: number): number {
    let delay = RATE_LIMIT_BASE_DELAY_MS * attempt
    if (typeof retryAfter === 'string' && retryAfter.trim() !== '') {
      const seconds = Number(retryAfter)
      const date = Date.parse(retryAfter)
      if (Number.isFinite(seconds)) {
        delay = seconds * 1000
      } else if (!Number.isNaN(date)) {
        delay = date - Date.now()
      }
    }
    return Math.min(Math.max(0, delay), RATE_LIMIT_MAX_DELAY_MS)
  }

  /**
   * Wait for the given time, stopping early when the download is cancelled or aborted
   */
  private static async waitUnlessCancelled(
    ms: number,
    signal: AbortSignal,
    isCancelled: () => boolean
  ): Promise<void> {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (signal.aborted || isCancelled()) {
        throw new DownloadCancelledError()
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, until - Date.now())))
    }
  }

  /**
   * Download the file in segments taken from a shared queue by N workers,
   * writing each one at its offset in the output file.
   * A slow connection only holds up its own segment, and a failed segment is retried alone.
   * @returns false if the download was cancelled
   */
  private static async downloadSegments(
    url: string,
    outputPath: string,
    fileSize: number,
    maxWorkers: number,
    queue: ReturnType<typeof getDownloadQueue>,
    queueItemId: string
  ): Promise<boolean> {
    const segments = this.splitIntoSegments(fileSize, maxWorkers)

    // Stops the other workers when one fails or the download is cancelled
    const controller = new AbortController()
    const counters: DownloadCounters = { valid: 0, speed: new SpeedMeter(SPEED_WINDOW_MS) }
    let nextSegment = 0

    // Sent on a timer and not on incoming data, so the speed drops to 0 when the download stalls
    const reportProgress = () => {
      const progress = Math.floor((counters.valid / fileSize) * 100)
      queue.updateProgress(queueItemId, progress, counters.speed.speed(), fileSize)
    }

    // Allocate the whole file up front, so every worker can write at its own offset
    const handle = await fs.open(outputPath, 'w')
    const progressTimer = setInterval(reportProgress, PROGRESS_INTERVAL_MS)
    try {
      await handle.truncate(fileSize)

      const worker = async () => {
        while (!controller.signal.aborted && nextSegment < segments.length) {
          const segment = segments[nextSegment++]
          try {
            await this.downloadSegmentWithRetry(
              url,
              segment,
              fileSize,
              handle,
              controller.signal,
              () => this.isCancelled(queueItemId),
              counters
            )
          } catch (error) {
            controller.abort()
            throw error
          }
        }
      }

      const workerCount = Math.max(1, Math.min(maxWorkers, segments.length))
      const results = await Promise.allSettled(Array.from({ length: workerCount }, worker))

      if (this.isCancelled(queueItemId)) {
        return false
      }
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected' && !(result.reason instanceof DownloadCancelledError)
      )
      if (failed) {
        throw failed.reason
      }
      reportProgress()
      return true
    } finally {
      clearInterval(progressTimer)
      await handle.close()
    }
  }

  /**
   * Download one segment, retrying it when the request fails or the data is incomplete
   */
  private static async downloadSegmentWithRetry(
    url: string,
    segment: DownloadSegment,
    fileSize: number,
    handle: FileHandle,
    signal: AbortSignal,
    isCancelled: () => boolean,
    counters: DownloadCounters
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let received = 0
      try {
        await this.downloadSegment(url, segment, fileSize, handle, signal, isCancelled, (bytes) => {
          received += bytes
          counters.valid += bytes
          counters.speed.add(bytes)
        })
        return
      } catch (error) {
        // Bytes of the failed attempt are downloaded again: out of the progress, not of the speed
        counters.valid -= received
        if (error instanceof DownloadCancelledError || signal.aborted) {
          throw error instanceof DownloadCancelledError ? error : new DownloadCancelledError()
        }
        if (error instanceof SegmentNotSupportedError) {
          throw error
        }
        const rateLimited = axios.isAxiosError(error) && error.response?.status === 429
        if (axios.isAxiosError(error)) {
          // Error responses of a stream request keep the body open
          error.response?.data?.destroy?.()
        }
        if (attempt >= MAX_SEGMENT_ATTEMPTS) {
          throw new Error(
            `Segmento ${segment.start}-${segment.end} non scaricato dopo ${attempt} tentativi: ${
              error instanceof Error ? error.message : error
            }`
          )
        }
        if (rateLimited) {
          const delay = this.rateLimitDelay(
            (error as AxiosError).response?.headers['retry-after'],
            attempt
          )
          logger.warning(
            'DownloadTask',
            `Troppe richieste al server (429): nuovo tentativo del segmento ${segment.start}-${segment.end} tra ${Math.round(delay / 1000)}s`
          )
          await this.waitUnlessCancelled(delay, signal, isCancelled)
          continue
        }
        logger.warning(
          'DownloadTask',
          `Segmento ${segment.start}-${segment.end} fallito (tentativo ${attempt}/${MAX_SEGMENT_ATTEMPTS}), nuovo tentativo`
        )
      }
    }
  }

  /**
   * Whether a Content-Range header ("bytes start-end/total", total may be "*") describes
   * exactly the requested segment of a file of the given size
   */
  private static matchesContentRange(
    contentRange: string,
    segment: DownloadSegment,
    fileSize: number
  ): boolean {
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange.trim())
    return (
      !!match &&
      Number(match[1]) === segment.start &&
      Number(match[2]) === segment.end &&
      (match[3] === '*' || Number(match[3]) === fileSize)
    )
  }

  /**
   * Download one segment with a Range request and write it at its offset in the file
   * @returns the number of bytes written
   */
  private static async downloadSegment(
    url: string,
    segment: DownloadSegment,
    fileSize: number,
    handle: FileHandle,
    signal: AbortSignal,
    isCancelled: () => boolean,
    onData: (bytes: number) => void
  ): Promise<number> {
    if (isCancelled()) {
      throw new DownloadCancelledError()
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'Range': `bytes=${segment.start}-${segment.end}`,
        // A compressed body would not match the requested byte range
        'Accept-Encoding': 'identity',
      },
      signal,
    })

    // A 200 means the server ignored the Range header and is sending the whole file:
    // fine only when this segment is the whole file
    const wholeFile = segment.start === 0 && segment.end === fileSize - 1
    if (response.status !== 206 && !(response.status === 200 && wholeFile)) {
      response.data.destroy()
      throw new SegmentNotSupportedError(
        `Il server non supporta i download a segmenti (status ${response.status})`
      )
    }
    const contentRange = response.headers['content-range']
    if (
      response.status === 206 &&
      typeof contentRange === 'string' &&
      !this.matchesContentRange(contentRange, segment, fileSize)
    ) {
      response.data.destroy()
      throw new SegmentNotSupportedError(
        `Content-Range inatteso: "${contentRange}" invece di "bytes ${segment.start}-${segment.end}/${fileSize}"`
      )
    }

    const expectedBytes = segment.end - segment.start + 1
    let written = 0
    for await (const data of response.data as AsyncIterable<Buffer>) {
      if (isCancelled()) {
        response.data.destroy()
        throw new DownloadCancelledError()
      }
      if (written + data.length > expectedBytes) {
        response.data.destroy()
        throw new Error(`Il segmento ha più byte del previsto (${expectedBytes})`)
      }
      await handle.write(data, 0, data.length, segment.start + written)
      written += data.length
      onData(data.length)
    }

    if (written !== expectedBytes) {
      throw new Error(`Segmento incompleto: ricevuti ${written} byte su ${expectedBytes}`)
    }
    return written
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

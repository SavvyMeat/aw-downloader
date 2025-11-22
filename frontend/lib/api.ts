const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';


// ============================================
// SERIES API
// ============================================

export interface Series {
  id: number;
  title: string;
  description?: string;
  status: string;
  totalSeasons: number;
  posterUrl?: string;
  posterPath?: string;
  totalMissingEpisodes: number;
  deleted: boolean;
  hasMissingDownloadUrls?: boolean;
  sonarrId?: number;
  alternateTitles?: string;
  genres?: string;
  year?: number;
  network?: string;
  preferredLanguage?: string;
  absolute?: boolean;
}

export interface PaginationMeta {
  total: number;
  perPage: number;
  currentPage: number;
  lastPage: number;
  firstPage: number;
  hasMorePages: boolean;
}

export interface SeriesListResponse {
  data: Series[];
  meta: PaginationMeta;
}

export interface FetchSeriesParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function fetchSeriesRouterPaths(): Promise<number[]> {
  
  const response = await fetch(`${API_BASE_URL}/api/series/router-paths`);
  if (!response.ok) throw new Error("Failed to fetch series");
  
  return response.json();
}

export async function fetchSeries(params: FetchSeriesParams = {}): Promise<SeriesListResponse> {
  const { page = 1, limit = 10, search = "", sortBy = "title", sortOrder = "asc" } = params;
  
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy: sortBy,
    sortOrder: sortOrder,
  });

  if (search) {
    queryParams.append('search', search);
  }

  const response = await fetch(`${API_BASE_URL}/api/series?${queryParams}`);
  if (!response.ok) throw new Error("Failed to fetch series");
  
  return response.json();
}

/**
 * Get poster URL for a series
 */
export function getSeriesPosterUrl(seriesId: number): string {
  return `${API_BASE_URL}/api/series/${seriesId}/poster`;
}

export interface Season {
  id: number;
  seriesId: number;
  seasonNumber: number;
  title: string;
  totalEpisodes: number;
  missingEpisodes: number;
  status: string;
  downloadUrls?: string[] | null;
  deleted: boolean;
}

export interface SeriesDetail extends Omit<Series, 'totalMissingEpisodes' | 'deleted'> {
  description?: string;
  year?: number;
  network?: string;
  genres?: string;
  seasons: Season[];
  countMissingEpisodes: number;
  countTotalEpisodes: number;
}

export async function fetchSeriesById(id: number): Promise<SeriesDetail> {
  const response = await fetch(`${API_BASE_URL}/api/series/${id}`);
  if (!response.ok) throw new Error("Series not found");
  
  return response.json();
}

export async function deleteSeries(id: number): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/series/${id}`, {
    method: "DELETE",
  });
  
  if (!response.ok) throw new Error("Failed to delete series");
  
  return response.json();
}

export async function syncSeriesMetadata(id: number): Promise<{ message: string; seriesId: number }> {
  const response = await fetch(`${API_BASE_URL}/api/series/${id}/sync-metadata`, {
    method: "POST",
  });
  
  if (!response.ok) throw new Error("Failed to sync metadata");
  
  return response.json();
}

export interface UpdateSeriesParams {
  preferredLanguage?: string;
  absolute?: boolean;
}

export async function updateSeries(
  id: number,
  params: UpdateSeriesParams
): Promise<SeriesDetail> {
  const response = await fetch(`${API_BASE_URL}/api/series/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) throw new Error("Failed to update series");
  
  return response.json();
}

// ============================================
// SEASONS API
// ============================================

export interface UpdateSeasonDownloadUrlsParams {
  downloadUrls: string;
}

export async function updateSeasonDownloadUrls(
  seasonId: number,
  params: UpdateSeasonDownloadUrlsParams
): Promise<Season> {
  const response = await fetch(`${API_BASE_URL}/api/seasons/${seasonId}/download-urls`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) throw new Error("Failed to update download URLs");
  
  return response.json();
}

// ============================================
// TASKS API
// ============================================

export interface Task {
  id: string;
  name: string;
  description: string;
  cron: string;
  lastRunAt: string | null;
  nextRunAt: string;
  running: boolean;
}

export async function fetchTasks(): Promise<Task[]> {
  const response = await fetch(`${API_BASE_URL}/api/tasks`);
  if (!response.ok) throw new Error("Failed to fetch tasks");
  
  const data = await response.json();
  return data;
}

export async function executeTask(taskId: string): Promise<{ message: string; task: Task }> {
  const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/execute`, {
    method: "POST",
  });
  
  if (!response.ok) throw new Error("Failed to execute task");
  
  return response.json();
}

export async function updateTaskInterval(taskId: string, intervalMinutes: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/interval`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ intervalMinutes }),
  });
  
  if (!response.ok) throw new Error("Failed to update task interval");
}

// ============================================
// CONFIG API
// ============================================

export interface Config {
  key: string;
  value: string;
}

export async function fetchConfigs(): Promise<Record<string, string>> {
  const response = await fetch(`${API_BASE_URL}/api/configs`);
  if (!response.ok) throw new Error("Failed to fetch configs");
  
  return response.json();
}

export async function updateConfig(key: string, value: any): Promise<{ key: string; value: string }> {
  const response = await fetch(`${API_BASE_URL}/api/configs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, value }),
  });
  
  if (!response.ok) throw new Error("Failed to update config");
  
  return response.json();
}

// ============================================
// DOWNLOAD QUEUE API
// ============================================

export interface QueueItem {
  id: string;
  seriesId: number;
  seasonId: number;
  episodeId: number;
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  status: "pending" | "downloading" | "completed" | "failed";
  progress: number;
  downloadSpeed?: number; // bytes per second
  addedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface QueueConfig {
  maxWorkers: number;
  queueLength: number;
  activeDownloads: number;
}

export interface QueueResponse {
  items: QueueItem[];
  config: QueueConfig;
}

export async function fetchDownloadQueue(): Promise<QueueResponse> {
  const response = await fetch(`${API_BASE_URL}/api/download-queue`);
  if (!response.ok) throw new Error("Failed to fetch download queue");
  
  return response.json();
}

export async function fetchQueueConfig(): Promise<QueueConfig> {
  const response = await fetch(`${API_BASE_URL}/api/download-queue/config`);
  if (!response.ok) throw new Error("Failed to fetch queue config");
  
  return response.json();
}

export interface AddToQueueParams {
  seriesId: number;
  seasonId: number;
  episodeId: number;
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
}

export async function addToDownloadQueue(params: AddToQueueParams): Promise<{ message: string; id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/download-queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) throw new Error("Failed to add to queue");
  
  return response.json();
}

export async function removeFromQueue(id: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/download-queue/${id}`, {
    method: "DELETE",
  });
  
  if (!response.ok) throw new Error("Failed to remove from queue");
  
  return response.json();
}

export async function clearCompletedQueue(): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/download-queue/completed`, {
    method: "DELETE",
  });
  
  if (!response.ok) throw new Error("Failed to clear completed items");
  
  return response.json();
}

// ============================================
// LOGS API
// ============================================

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  SUCCESS = "success",
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  details?: any;
}

export interface LogsResponse {
  logs: LogEntry[];
}

export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  byCategory: Record<string, number>;
}

export interface FetchLogsParams {
  level?: LogLevel;
  category?: string;
  limit?: number;
  since?: string;
}

export async function fetchLogs(params: FetchLogsParams = {}): Promise<LogsResponse> {
  const queryParams = new URLSearchParams();
  
  if (params.level) queryParams.append("level", params.level);
  if (params.category) queryParams.append("category", params.category);
  if (params.limit) queryParams.append("limit", params.limit.toString());
  if (params.since) queryParams.append("since", params.since);
  
  const url = `${API_BASE_URL}/api/logs${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch logs:", response.status, errorText);
      throw new Error(`Failed to fetch logs: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    console.error("Error fetching logs from:", url, error);
    throw error;
  }
}

export async function fetchLogStats(): Promise<LogStats> {
  const response = await fetch(`${API_BASE_URL}/api/logs/stats`);
  
  if (!response.ok) throw new Error("Failed to fetch log stats");
  
  return response.json();
}

export async function clearLogs(): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/logs`, {
    method: "DELETE",
  });
  
  if (!response.ok) throw new Error("Failed to clear logs");
  
  return response.json();
}

// ============================================
// ROOT FOLDERS API
// ============================================

export interface RootFolder {
  id: number;
  sonarrId: number;
  path: string;
  mappedPath: string | null;
  accessible: boolean;
  freeSpace: number | null;
  totalSpace: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRootFoldersResponse {
  message: string;
  syncedCount: number;
  updatedCount: number;
  rootFolders: RootFolder[];
}

export async function fetchRootFolders(): Promise<RootFolder[]> {
  const response = await fetch(`${API_BASE_URL}/api/root-folders`);
  
  if (!response.ok) throw new Error("Failed to fetch root folders");
  
  return response.json();
}

export async function syncRootFolders(): Promise<SyncRootFoldersResponse> {
  const response = await fetch(`${API_BASE_URL}/api/root-folders/sync`, {
    method: "POST",
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to sync root folders");
  }
  
  return response.json();
}

export async function updateRootFolderMapping(
  id: number,
  mappedPath: string | null
): Promise<{ message: string; rootFolder: RootFolder }> {
  const response = await fetch(`${API_BASE_URL}/api/root-folders/${id}/mapping`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mappedPath }),
  });
  
  if (!response.ok) throw new Error("Failed to update root folder mapping");
  
  return response.json();
}

// Health check types and functions
export interface SonarrHealthStatus {
  healthy: boolean;
  lastCheck: string | null;
  cached?: boolean;
}

export async function checkSonarrHealth(): Promise<SonarrHealthStatus> {
  const response = await fetch(`${API_BASE_URL}/api/health/sonarr`);
  if (!response.ok) throw new Error("Failed to check Sonarr health");
  return response.json();
}

export async function forceSonarrHealthCheck(): Promise<SonarrHealthStatus> {
  const response = await fetch(`${API_BASE_URL}/api/health/sonarr/force`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("Failed to force Sonarr health check");
  return response.json();
}

export async function getSonarrStatus(): Promise<SonarrHealthStatus> {
  const response = await fetch(`${API_BASE_URL}/api/health/sonarr/status`);
  if (!response.ok) throw new Error("Failed to get Sonarr status");
  return response.json();
}

export interface AppVersion {
  version: string;
}

export async function fetchAppVersion(): Promise<AppVersion> {
  const response = await fetch(`${API_BASE_URL}/api/health/version`);
  if (!response.ok) throw new Error("Failed to fetch app version");
  return response.json();
}

// ============================================
// SONARR TAGS API
// ============================================

export interface SonarrTag {
  id: number;
  label: string;
}

export async function fetchSonarrTags(): Promise<SonarrTag[]> {
  const response = await fetch(`${API_BASE_URL}/api/sonarr/tags`);
  if (!response.ok) throw new Error("Failed to fetch Sonarr tags");
  return response.json();
}

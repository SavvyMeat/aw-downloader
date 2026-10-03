import { createClient, waitFor } from './lib/http.mjs'

const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

export const aw = createClient(env('AW_URL'))
export const sonarr = createClient(env('SONARR_URL'), { 'X-Api-Key': env('SONARR_API_KEY') })
export const radarr = createClient(env('RADARR_URL'), { 'X-Api-Key': env('RADARR_API_KEY') })

/** With SANDBOX_FAKE_DOWNLOADS=false AW downloads the real files, which takes much longer */
export const FAKE_DOWNLOADS = !['false', '0', 'no', 'off'].includes(
  (process.env.SANDBOX_FAKE_DOWNLOADS ?? 'true').trim().toLowerCase()
)
export const DOWNLOAD_TIMEOUT_MS = FAKE_DOWNLOADS ? 180_000 : 60 * 60_000

export const SONARR_ROOT_FOLDER = '/data/media/anime'
export const RADARR_ROOT_FOLDER = '/data/media/movies'

/** Anime used as test data: added with no monitored episode, the tests monitor the ones they need */
export const TEST_SERIES_TVDB_ID = 423732 // SAKAMOTO DAYS

/** Film used as test data */
export const TEST_MOVIE_TMDB_ID = 900667 // One Piece Film Red

/** Shared state filled by setup() and read by the tests */
export const context = {
  sonarrSeries: null,
  awSeries: null,
  radarrMovie: null,
  awFilm: null,
}

async function ensureRootFolder(client, path) {
  const folders = await client.get('/api/v3/rootfolder')
  if (!folders.some((folder) => folder.path.replace(/\/+$/, '') === path)) {
    await client.post('/api/v3/rootfolder', { path })
  }
}

export async function setAwConfig(key, value) {
  await aw.post('/api/configs', { key, value })
}

export async function runAwTask(taskId) {
  await aw.post(`/api/tasks/${taskId}/execute`)
}

async function configureAw() {
  await setAwConfig('sonarr_url', env('SONARR_URL'))
  await setAwConfig('sonarr_token', env('SONARR_API_KEY'))
  await setAwConfig('radarr_url', env('RADARR_URL'))
  await setAwConfig('radarr_token', env('RADARR_API_KEY'))
  await setAwConfig('radarr_enabled', true)

  // Refresh the cached health status that AW checks before calling Sonarr/Radarr
  await waitFor('AW connected to Sonarr', async () => (await aw.post('/api/health/sonarr/force')).healthy)
  await waitFor('AW connected to Radarr', async () => (await aw.post('/api/health/radarr/force')).healthy)

  await aw.post('/api/root-folders/sync', { service: 'sonarr' })
  await aw.post('/api/root-folders/sync', { service: 'radarr' })
}

async function ensureSonarrSeries() {
  let series = (await sonarr.get('/api/v3/series')).find((s) => s.tvdbId === TEST_SERIES_TVDB_ID)

  if (!series) {
    const [lookup] = await sonarr.get(`/api/v3/series/lookup?term=tvdb:${TEST_SERIES_TVDB_ID}`)
    if (!lookup) throw new Error(`Series tvdb:${TEST_SERIES_TVDB_ID} not found by Sonarr lookup`)
    const [qualityProfile] = await sonarr.get('/api/v3/qualityprofile')

    series = await sonarr.post('/api/v3/series', {
      ...lookup,
      qualityProfileId: qualityProfile.id,
      rootFolderPath: SONARR_ROOT_FOLDER,
      seriesType: 'anime',
      seasonFolder: true,
      addOptions: { monitor: 'none', searchForMissingEpisodes: false },
    })
  }

  return series
}

/**
 * AW only syncs monitored series and monitored seasons with at least one monitored (or downloaded)
 * episode, while monitor "none" unmonitors all of them. Keep season 1 monitored with a single
 * monitored "sentinel" episode (the last aired one), so that AW looks up its AnimeWorld identifiers
 * but downloads nothing the tests use. Idempotent; call it once Sonarr has created the episodes.
 */
async function prepareSeasonMonitoring(seriesId) {
  let series = await sonarr.get(`/api/v3/series/${seriesId}`)
  if (!series.monitored || !series.seasons.find((s) => s.seasonNumber === 1)?.monitored) {
    // Monitoring the season also monitors all its episodes (fixed below)
    series = await sonarr.put(`/api/v3/series/${series.id}`, {
      ...series,
      monitored: true,
      seasons: series.seasons.map((s) => (s.seasonNumber === 1 ? { ...s, monitored: true } : s)),
    })
  }

  const episodes = await sonarr.get(`/api/v3/episode?seriesId=${series.id}`)
  const now = Date.now()
  const sentinel = episodes
    .filter((e) => e.seasonNumber === 1 && e.airDateUtc && Date.parse(e.airDateUtc) < now)
    .sort((a, b) => b.episodeNumber - a.episodeNumber)[0]
  if (!sentinel || sentinel.episodeNumber <= 5) {
    throw new Error('The test series needs more than 5 aired episodes in season 1')
  }

  const toUnmonitor = episodes.filter((e) => e.monitored && e.id !== sentinel.id).map((e) => e.id)
  if (toUnmonitor.length > 0) {
    await sonarr.put('/api/v3/episode/monitor', { episodeIds: toUnmonitor, monitored: false })
  }
  if (!sentinel.monitored) {
    await sonarr.put('/api/v3/episode/monitor', { episodeIds: [sentinel.id], monitored: true })
  }
  return series
}

async function ensureAwSeries(sonarrSeriesId) {
  const findSeries = async () =>
    (await aw.get('/api/series?limit=100')).data.find((s) => s.sonarrId === sonarrSeriesId)

  // Without AnimeWorld identifiers the fetch task cannot find any download link
  const hasSeason1Identifiers = async (series) => {
    const seasons = await aw.get(`/api/seasons/series/${series.id}`)
    return seasons.find((s) => s.seasonNumber === 1)?.downloadUrls?.length > 0
  }

  const existing = await findSeries()
  if (!existing || !(await hasSeason1Identifiers(existing))) {
    await runAwTask('update_metadata')
  }

  return waitFor(
    'series synced into AW with the AnimeWorld identifiers of season 1 (search on the real AnimeWorld)',
    async () => {
      const series = await findSeries()
      return series && (await hasSeason1Identifiers(series)) && series
    },
    { timeoutMs: 300_000, intervalMs: 5_000 }
  )
}

async function ensureRadarrMovie() {
  const existing = (await radarr.get('/api/v3/movie')).find((m) => m.tmdbId === TEST_MOVIE_TMDB_ID)
  if (existing) return existing

  const lookup = await radarr.get(`/api/v3/movie/lookup/tmdb?tmdbId=${TEST_MOVIE_TMDB_ID}`)
  const [qualityProfile] = await radarr.get('/api/v3/qualityprofile')

  return radarr.post('/api/v3/movie', {
    ...lookup,
    qualityProfileId: qualityProfile.id,
    rootFolderPath: RADARR_ROOT_FOLDER,
    monitored: true, // AW only syncs (and downloads) monitored films
    minimumAvailability: 'released',
    addOptions: { monitor: 'movieOnly', searchForMovie: false },
  })
}

async function ensureAwFilm(radarrMovieId) {
  const findFilm = async () =>
    (await aw.get('/api/films?limit=100')).data.find((f) => f.radarrId === radarrMovieId)

  if (!(await findFilm())?.animeworldUrl) {
    await runAwTask('update_film_metadata')
  }
  return waitFor(
    'film synced into AW with its AnimeWorld identifier (search on the real AnimeWorld)',
    async () => {
      const film = await findFilm()
      return film?.animeworldUrl && film
    },
    { timeoutMs: 300_000, intervalMs: 5_000 }
  )
}

/**
 * Configure the whole stack. Idempotent: it can run again on an already configured stack.
 */
export async function setup() {
  console.log(`[setup] download ${FAKE_DOWNLOADS ? 'finti (video di prova)' : 'REALI da AnimeWorld'}`)

  console.log('[setup] root folder Sonarr/Radarr')
  await ensureRootFolder(sonarr, SONARR_ROOT_FOLDER)
  await ensureRootFolder(radarr, RADARR_ROOT_FOLDER)

  console.log('[setup] configurazione AW')
  await configureAw()

  console.log(`[setup] serie di test tvdb:${TEST_SERIES_TVDB_ID} in Sonarr`)
  const series = await ensureSonarrSeries()
  await waitFor('Sonarr episodes of the test series', async () => {
    const episodes = await sonarr.get(`/api/v3/episode?seriesId=${series.id}`)
    return episodes.length > 0
  })
  await prepareSeasonMonitoring(series.id)
  context.sonarrSeries = await sonarr.get(`/api/v3/series/${series.id}`)

  console.log('[setup] sincronizzazione della serie in AW')
  context.awSeries = await ensureAwSeries(series.id)

  console.log(`[setup] film di test tmdb:${TEST_MOVIE_TMDB_ID} in Radarr`)
  const movie = await ensureRadarrMovie()
  context.radarrMovie = await radarr.get(`/api/v3/movie/${movie.id}`)

  console.log('[setup] sincronizzazione del film in AW')
  context.awFilm = await ensureAwFilm(movie.id)

  console.log('[setup] completato')
}

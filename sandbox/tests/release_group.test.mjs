import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aw,
  sonarr,
  radarr,
  context,
  setAwConfig,
  runAwTask,
  DOWNLOAD_TIMEOUT_MS,
} from './setup.mjs'
import { waitFor } from './lib/http.mjs'

/**
 * Wait for a download started by an AW task: the *arr has imported the file and AW no longer
 * has the item in its queue (AW updates the imported file before removing the item).
 */
async function waitForDownload(description, isImported, isQueued) {
  try {
    await waitFor(
      description,
      async () => (await isImported()) && !(await aw.get('/api/download-queue')).items.some(isQueued),
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, intervalMs: 3_000 }
    )
  } catch (error) {
    throw new Error(`${error.message}. Ultimi log AW: ${await recentAwLogs()}`)
  }
}

async function recentAwLogs() {
  const logs = []
  for (const level of ['error', 'warning']) {
    logs.push(...(await aw.get(`/api/logs?level=${level}&limit=5`)).logs)
  }
  return logs.map((log) => `[${log.level}/${log.category}] ${log.message}`).join(' | ') || 'nessuno'
}

/**
 * Let AW download an episode through its "fetch_wanted" task and return the Sonarr episode file
 */
async function downloadEpisode(seasonNumber, episodeNumber) {
  const episodes = await sonarr.get(`/api/v3/episode?seriesId=${context.sonarrSeries.id}`)
  const episode = episodes.find(
    (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
  )
  assert.ok(episode, `episode S${seasonNumber}E${episodeNumber} exists in Sonarr`)
  assert.equal(episode.hasFile, false, 'episode has no file before the test (reset with "down -v")')

  // Monitored + missing = wanted: the task picks it up and searches it on AnimeWorld
  await sonarr.put('/api/v3/episode/monitor', { episodeIds: [episode.id], monitored: true })
  await runAwTask('fetch_wanted')

  await waitForDownload(
    `S${seasonNumber}E${episodeNumber} downloaded by AW and imported by Sonarr`,
    async () => (await sonarr.get(`/api/v3/episode/${episode.id}`)).hasFile,
    (item) => item.mediaType === 'episode' && item.episodeId === episode.id
  )

  const imported = await sonarr.get(`/api/v3/episode/${episode.id}`)
  return sonarr.get(`/api/v3/episodefile/${imported.episodeFileId}`)
}

/**
 * Let AW download the test film through its "fetch_wanted_films" task and return the Radarr movie file
 */
async function downloadMovie() {
  const movieId = context.radarrMovie.id

  // Start from a missing film, also if an automatic run of the task already downloaded it
  const before = await radarr.get(`/api/v3/movie/${movieId}`)
  if (before.movieFile?.id) {
    await radarr.delete(`/api/v3/moviefile/${before.movieFile.id}`)
  }

  await runAwTask('fetch_wanted_films')

  await waitForDownload(
    `${before.title} downloaded by AW and imported by Radarr`,
    async () => (await radarr.get(`/api/v3/movie/${movieId}`)).hasFile,
    (item) => item.mediaType === 'film' && item.filmId === context.awFilm.id
  )

  const imported = await radarr.get(`/api/v3/movie/${movieId}`)
  return radarr.get(`/api/v3/moviefile/${imported.movieFile.id}`)
}

test('Sonarr: release group set on the imported episode file when enabled', async () => {
  await setAwConfig('sonarr_release_group_enabled', true)
  await setAwConfig('sonarr_release_group', 'AnimeWorld')

  const episodeFile = await downloadEpisode(1, 1)

  assert.equal(episodeFile.releaseGroup, 'AnimeWorld')
  assert.doesNotMatch(episodeFile.relativePath, /\[AnimeWorld\]/, 'filename is not prefixed')
  assert.notEqual(episodeFile.quality.quality.name, 'Unknown', 'quality detected by Sonarr is kept')
})

test('Sonarr: no release group when disabled (current behaviour)', async () => {
  await setAwConfig('sonarr_release_group_enabled', false)

  const episodeFile = await downloadEpisode(1, 2)

  assert.ok(!episodeFile.releaseGroup, `no release group (got ${episodeFile.releaseGroup})`)
})

test('Radarr: release group set on the imported movie file when enabled', async () => {
  await setAwConfig('radarr_release_group_enabled', true)
  await setAwConfig('radarr_release_group', 'AnimeWorld')

  const movieFile = await downloadMovie()

  assert.equal(movieFile.releaseGroup, 'AnimeWorld')
  assert.doesNotMatch(movieFile.relativePath, /\[AnimeWorld\]/, 'filename is not prefixed')
  assert.notEqual(movieFile.quality.quality.name, 'Unknown', 'quality detected by Radarr is kept')
})

test('Radarr: no release group when disabled (current behaviour)', async () => {
  await setAwConfig('radarr_release_group_enabled', false)

  const movieFile = await downloadMovie()

  assert.ok(!movieFile.releaseGroup, `no release group (got ${movieFile.releaseGroup})`)
})

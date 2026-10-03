import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chown, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { aw, sonarr, context, setAwConfig } from './setup.mjs'
import { downloadEpisode, downloadMovie } from './lib/downloads.mjs'

const FIXTURES_URL = process.env.SANDBOX_FIXTURES_URL

/** Size of a fixture video (AW downloads episode.mp4 with SANDBOX_FAKE_DOWNLOADS) */
async function fixtureSize(name) {
  const response = await fetch(`${FIXTURES_URL}/${name}`, { method: 'HEAD' })
  return Number(response.headers.get('content-length'))
}

/**
 * Put another video (bigger than the one AW downloads, same quality) in a Sonarr/Radarr folder:
 * the rescan imports it instead of the file copied by AW
 */
async function placeOtherFile(folder, fileName) {
  const response = await fetch(`${FIXTURES_URL}/other.mp4`)
  const content = Buffer.from(await response.arrayBuffer())
  await mkdir(folder, { recursive: true })
  const filePath = path.join(folder, fileName)
  await writeFile(filePath, content)
  await chown(filePath, 1000, 1000) // owner of the media volume (Sonarr, Radarr and AW)
  return content.length
}

/**
 * Sonarr renames asynchronously: poll the episode file for up to `ms` and tell whether it has
 * been moved into a season folder (what AW's rename does, as "Rename Episodes" is off)
 */
async function movedIntoSeasonFolder(episodeFileId, ms = 15_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const file = await sonarr.get(`/api/v3/episodefile/${episodeFileId}`)
    if (file.relativePath.includes('/')) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return false
}

async function awWarningsAbout(text) {
  const { logs } = await aw.get('/api/logs?level=warning&limit=50')
  return logs.map((log) => log.message).filter((message) => message.includes(text))
}

test('Sonarr: release group set on the imported episode file when enabled', async () => {
  await setAwConfig('sonarr_release_group_enabled', true)
  await setAwConfig('sonarr_release_group', 'AnimeWorld')

  const episodeFile = await downloadEpisode(1, 1)

  assert.equal(episodeFile.size, await fixtureSize('episode.mp4'), 'imported file is the one AW copied')
  assert.equal(episodeFile.releaseGroup, 'AnimeWorld')
  assert.doesNotMatch(episodeFile.relativePath, /\[AnimeWorld\]/, 'filename is not prefixed')
  assert.notEqual(episodeFile.quality.quality.name, 'Unknown', 'quality detected by Sonarr is kept')
  assert.ok(await movedIntoSeasonFolder(episodeFile.id), 'renamed into the season folder by AW')
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

  assert.equal(movieFile.size, await fixtureSize('episode.mp4'), 'imported file is the one AW copied')
  assert.equal(movieFile.releaseGroup, 'AnimeWorld')
  assert.doesNotMatch(movieFile.relativePath, /\[AnimeWorld\]/, 'filename is not prefixed')
  assert.notEqual(movieFile.quality.quality.name, 'Unknown', 'quality detected by Radarr is kept')
})

test('Radarr: no release group when disabled (current behaviour)', async () => {
  await setAwConfig('radarr_release_group_enabled', false)

  const movieFile = await downloadMovie()

  assert.ok(!movieFile.releaseGroup, `no release group (got ${movieFile.releaseGroup})`)
})

test('Sonarr: another file imported for the episode is left untouched', async () => {
  await setAwConfig('sonarr_release_group_enabled', true)
  await setAwConfig('sonarr_release_group', 'AnimeWorld')

  const series = context.sonarrSeries
  let otherSize
  const episodeFile = await downloadEpisode(1, 3, {
    beforeDownload: async () => {
      otherSize = await placeOtherFile(series.path, `${series.title} - S01E03 - other.mp4`)
    },
  })

  assert.equal(episodeFile.size, otherSize, 'Sonarr imported the other (bigger) file')
  assert.ok(!episodeFile.releaseGroup, `release group not set (got ${episodeFile.releaseGroup})`)
  assert.ok(!(await movedIntoSeasonFolder(episodeFile.id)), 'not renamed into the season folder by AW')
  assert.ok(
    (await awWarningsAbout(`${series.title} S1E3`)).some((m) => m.includes('non corrisponde')),
    'AW logged that the linked file is not the copied one'
  )
})

test('Radarr: another file imported for the movie is left untouched', async () => {
  await setAwConfig('radarr_release_group_enabled', true)
  await setAwConfig('radarr_release_group', 'AnimeWorld')

  const movie = context.radarrMovie
  let otherSize
  const movieFile = await downloadMovie({
    beforeDownload: async () => {
      otherSize = await placeOtherFile(movie.path, `${movie.title} (${movie.year}) - other.mp4`)
    },
  })

  assert.equal(movieFile.size, otherSize, 'Radarr imported the other (bigger) file')
  assert.ok(!movieFile.releaseGroup, `release group not set (got ${movieFile.releaseGroup})`)
  assert.ok(
    (await awWarningsAbout(movie.title)).some((m) => m.includes('non corrisponde')),
    'AW logged that the linked file is not the copied one'
  )
})

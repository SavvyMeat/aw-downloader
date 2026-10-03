import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { aw, context, setAwConfig } from './setup.mjs'
import { downloadEpisode, downloadMovie } from './lib/downloads.mjs'

/** AnimeWorld identifiers of dubbed entries end with "-ita" (e.g. "sakamoto-days-ita.WHHr6") */
const DUBBED_IDENTIFIER = /-ita\.[^.]+$/

const languageNames = (file) => file.languages.map((language) => language.name)

/**
 * Switch the AnimeWorld version of the test series and look up its identifiers again,
 * as the "sync" button of the series page does
 */
async function setSeriesLanguage(preferredLanguage) {
  const seriesId = context.awSeries.id
  await aw.put(`/api/series/${seriesId}`, { preferredLanguage })
  await aw.post(`/api/series/${seriesId}/sync-metadata`)

  const seasons = await aw.get(`/api/seasons/series/${seriesId}`)
  return seasons.find((s) => s.seasonNumber === 1)?.downloadUrls ?? []
}

/**
 * Switch the AnimeWorld version of the test film and look up its identifier again
 */
async function setFilmLanguage(preferredLanguage) {
  const filmId = context.awFilm.id
  await aw.put(`/api/films/${filmId}`, { preferredLanguage })
  await aw.post(`/api/films/${filmId}/sync-metadata`)

  return (await aw.get(`/api/films/${filmId}`)).animeworldUrl
}

describe('Sonarr: dubbed episodes', () => {
  before(async () => {
    const identifiers = await setSeriesLanguage('dub')
    assert.ok(
      identifiers.length > 0 && identifiers.every((id) => DUBBED_IDENTIFIER.test(id)),
      `season 1 linked to the dubbed AnimeWorld entries (got ${identifiers.join(', ')})`
    )
  })

  after(async () => {
    await setSeriesLanguage('sub')
  })

  test('Sonarr: Italian audio language set on a dubbed episode when enabled', async () => {
    await setAwConfig('sonarr_audio_language_enabled', true)

    const episodeFile = await downloadEpisode(1, 4)

    assert.deepEqual(languageNames(episodeFile), ['Italian'])
  })

  test('Sonarr: audio language left to Sonarr when disabled (current behaviour)', async () => {
    await setAwConfig('sonarr_audio_language_enabled', false)

    const episodeFile = await downloadEpisode(1, 5)

    // Sonarr cannot tell the language from the filename and uses the original one of the series
    assert.ok(
      !languageNames(episodeFile).includes('Italian'),
      `language not set by AW (got ${languageNames(episodeFile).join(', ')})`
    )
  })
})

describe('Radarr: dubbed films', () => {
  before(async () => {
    const identifier = await setFilmLanguage('dub')
    assert.match(identifier ?? '', DUBBED_IDENTIFIER, 'film linked to the dubbed AnimeWorld entry')
  })

  after(async () => {
    await setFilmLanguage('sub')
  })

  test('Radarr: Italian audio language set on a dubbed film when enabled', async () => {
    await setAwConfig('radarr_audio_language_enabled', true)

    const movieFile = await downloadMovie()

    assert.deepEqual(languageNames(movieFile), ['Italian'])
  })

  test('Radarr: audio language left to Radarr when disabled (current behaviour)', async () => {
    await setAwConfig('radarr_audio_language_enabled', false)

    const movieFile = await downloadMovie()

    // Radarr cannot tell the language from the filename and uses the original one of the film
    assert.ok(
      !languageNames(movieFile).includes('Italian'),
      `language not set by AW (got ${languageNames(movieFile).join(', ')})`
    )
  })
})

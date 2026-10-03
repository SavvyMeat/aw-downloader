import { test } from '@japa/runner'
import * as cheerio from 'cheerio'
import { parseAnimeworldAudioLanguage, toArrLanguage } from '../../app/helpers/audio_language.js'

/**
 * Minimal AnimeWorld anime page, with the info block read by parseAnimeworldAudioLanguage
 */
function animePage(audio: string) {
  return cheerio.load(`<html><body>
    <dl class="meta">
      <dt>Categoria:</dt><dd><a href="/tv-series">Anime</a></dd>
      ${audio}
      <dt>Data di Uscita:</dt><dd>11 Gennaio 2025</dd>
    </dl>
  </body></html>`)
}

test.group('parseAnimeworldAudioLanguage', () => {
  test('reads the audio of a subbed entry', ({ assert }) => {
    const page = animePage('<dt>Audio:</dt><dd><a href="/filter?language=jp">Giapponese</a></dd>')
    assert.equal(parseAnimeworldAudioLanguage(page), 'jp')
  })

  test('reads the audio of a dubbed entry', ({ assert }) => {
    const page = animePage('<dt>Audio:</dt><dd><a href="/filter?language=it">Italiano</a></dd>')
    assert.equal(parseAnimeworldAudioLanguage(page), 'it')
  })

  test('reads the audio with a differently written label', ({ assert }) => {
    for (const label of ['Audio', 'audio :', '  AUDIO:  ', '\n  Audio\n']) {
      const page = animePage(
        `<dt>${label}</dt><dd><a href="/filter?language=jp">Giapponese</a></dd>`
      )
      assert.equal(parseAnimeworldAudioLanguage(page), 'jp', `label "${label}"`)
    }
  })

  test('ignores labels that only contain "audio"', ({ assert }) => {
    const page = animePage(
      '<dt>Audio originale:</dt><dd><a href="/filter?language=jp">Giapponese</a></dd>'
    )
    assert.isNull(parseAnimeworldAudioLanguage(page))
  })

  test('returns null when the page does not show the audio', ({ assert }) => {
    assert.isNull(parseAnimeworldAudioLanguage(animePage('')))
  })

  test('returns null when the audio has no language link', ({ assert }) => {
    assert.isNull(parseAnimeworldAudioLanguage(animePage('<dt>Audio:</dt><dd>Italiano</dd>')))
  })
})

test.group('toArrLanguage', () => {
  test('maps the original audio of subbed entries', ({ assert }) => {
    assert.deepEqual(toArrLanguage('jp'), { id: 8, name: 'Japanese' })
    assert.deepEqual(toArrLanguage('ch'), { id: 10, name: 'Chinese' })
    assert.deepEqual(toArrLanguage('kr'), { id: 21, name: 'Korean' })
  })

  test('maps the audio of dubbed entries to Italian', ({ assert }) => {
    assert.deepEqual(toArrLanguage('it'), { id: 5, name: 'Italian' })
  })

  test('returns null for a missing or unknown language', ({ assert }) => {
    // Sonarr/Radarr keep the language they detected
    assert.isNull(toArrLanguage(null))
    assert.isNull(toArrLanguage(undefined))
    assert.isNull(toArrLanguage('xx'))
    assert.isNull(toArrLanguage('constructor'))
  })
})

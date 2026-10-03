import { AnimeworldService } from '#services/animeworld_service'
import { test } from '@japa/runner'

// SAKAMOTO DAYS season 1 is split in two parts on AnimeWorld, in both versions
const sakamotoDaysSub = ['sakamoto-days.k5hXg', 'sakamoto-days-part-2.87HIC']
const sakamotoDaysDub = ['sakamoto-days-ita.WHHr6', 'sakamoto-days-part-2-ita.ZYR8Y']

test.group('AnimeWorld episodes audio', () => {
  test('episodes of a subbed multi-part anime have the original audio', async ({ assert }) => {
    const animeworldService = new AnimeworldService()

    const episodes = await animeworldService.getEpisodesFromMultiplePages(sakamotoDaysSub)

    const firstPart = episodes[1]
    const secondPart = episodes[Math.max(...Object.keys(episodes).map(Number))]
    assert.equal(firstPart.audioLanguage, 'jp')
    assert.equal(secondPart.audioLanguage, 'jp')
  })
    .tags(['@anime'], 'append')
    .timeout(120000)

  test('episodes of a dubbed multi-part anime have the Italian audio', async ({ assert }) => {
    const animeworldService = new AnimeworldService()

    const episodes = await animeworldService.getEpisodesFromMultiplePages(sakamotoDaysDub)

    const firstPart = episodes[1]
    const secondPart = episodes[Math.max(...Object.keys(episodes).map(Number))]
    assert.equal(firstPart.audioLanguage, 'it')
    assert.equal(secondPart.audioLanguage, 'it')
  })
    .tags(['@anime'], 'append')
    .timeout(120000)

  test('the download link comes with the audio language of the entry', async ({ assert }) => {
    const animeworldService = new AnimeworldService()

    const download = await animeworldService.findEpisodeDownload(sakamotoDaysDub, 1)

    assert.isNotNull(download)
    assert.match(download!.url, /^https?:\/\//)
    assert.equal(download!.audioLanguage, 'it')
  })
    .tags(['@anime'], 'append')
    .timeout(120000)
})

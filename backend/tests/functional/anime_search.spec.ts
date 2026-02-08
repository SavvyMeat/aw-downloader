import { AnimeworldService, FilterDub, FilterType } from '#services/animeworld_service'
import { MetadataSyncService } from '#services/metadata_sync_service'
import logger from '@adonisjs/core/services/logger'
import { test } from '@japa/runner'

// Test data for JoJo's Bizarre Adventure seasons
const jojoSeasons = [
  {
    title: "JoJo's Bizarre Adventure",
    from: '2012-10-05T00:00:00.000Z',
    to: '2013-04-05T23:59:59.999Z',
    expectedResults: ['le-bizzarre-avventure-di-jojo.emoOe'],
  },
  {
    title: "JoJo's Bizarre Adventure: Stardust Crusaders",
    from: '2014-04-04T00:00:00.000Z',
    to: '2015-06-19T23:59:59.999Z',
    expectedResults: [
      'le-bizzarre-avventure-di-jojo-stardust-crusaders.aLPgP',
      'le-bizzarre-avventure-di-jojo-stardust-crusaders-2.A9gze',
    ],
  },
  {
    title: "JoJo's Bizarre Adventure: Diamond is Unbreakable",
    from: '2016-04-01T00:00:00.000Z',
    to: '2016-12-23T23:59:59.999Z',
    expectedResults: ['le-bizzarre-avventure-di-jojo-diamond-is-unbreakable.S8tDp'],
  },
  {
    title: "JoJo's Bizarre Adventure: Golden Wind",
    from: '2018-10-05T00:00:00.000Z',
    to: '2019-07-28T23:59:59.999Z',
    expectedResults: ['le-bizzarre-avventure-di-jojo-vento-aureo.xg4zt'],
  },
  {
    title: "JoJo's Bizarre Adventure: Stone Ocean",
    from: '2021-12-01T00:00:00.000Z',
    to: '2022-12-01T23:59:59.999Z',
    expectedResults: [
      'le-bizzarre-avventure-di-jojo-stone-ocean.kX5uX',
      'le-bizzarre-avventure-di-jojo-stone-ocean-parte-2.5ljGc',
      'le-bizzarre-avventure-di-jojo-stone-ocean-parte-3.Mw8w8',
    ],
  },
]

// Test data for Re:Zero seasons
const rezeroSeasons = [
  {
    title: 'Re:Zero',
    from: '2016-04-04T00:00:00.000Z',
    to: '2016-09-19T23:59:59.999Z',
    expectedResults: ['re-zero-kara-hajimeru-isekai-seikatsu.V_qgZ'],
  },
  {
    title: 'Re:Zero',
    from: '2020-07-08T00:00:00.000Z',
    to: '2021-03-24T23:59:59.999Z',
    expectedResults: [
      'rezero-kara-hajimeru-isekai-seikatsu-2.ROlN7',
      'rezero-kara-hajimeru-isekai-seikatsu-2-part-2.i8xY3',
    ],
  },
  {
    title: 'Re:Zero',
    from: '2024-10-02T00:00:00.000Z',
    to: '2025-03-26T23:59:59.999Z',
    expectedResults: ['rezero-kara-hajimeru-isekai-seikatsu-3.4zRLd'],
  },
]

// Test data for My Hero Academia movie
const myHeroAcademiaMovie = {
  title: "My Hero Academia: World Heroes' Mission",
  from: '2021-08-06T00:00:00.000Z',
  to: '2021-08-06T23:59:59.999Z',
  expectedResults: ['boku-no-hero-academia-the-movie-3-world-heroes-mission-ita.TXzOW'],
}

test.group('Anime Search Integration', () => {
  test("search all seasons of JoJo's Bizarre Adventure on AnimeWorld", async ({ assert }) => {
    const animeworldService = new AnimeworldService()
    const candidateTitles = [
      "JoJo's Bizarre Adventure (2012)",
      'Le bizzarre avventure di JoJo',
      "JoJo's Bizarre Adventure (TV)",
      'JoJo no Kimyou na Bouken (TV)',
    ]

    logger.info(`\n=== JoJo's Bizarre Adventure Season-by-Season Search ===$`)

    for (const season of jojoSeasons) {
      logger.info(`\n--- Testing: ${season.title} (${season.from}-${season.to}) ---`)

      // Extract years from UTC dates
      const fromDate = new Date(season.from)
      const toDate = new Date(season.to)
      const years: number[] = []
      for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year++) {
        years.push(year)
      }

      // Search on AnimeWorld with year filter
      const animeworldResults = []
      const candidateTitlesCopy = [...candidateTitles]
      while (animeworldResults.length === 0 && candidateTitlesCopy.length > 0) {
        const sonarrName = candidateTitlesCopy.shift()!
        const res = await animeworldService.searchAnimeWithFilter({
          keyword: sonarrName,
          type: [FilterType.Anime, FilterType.Ona],
          dub: FilterDub.Sub,
          seasonYear: years,
        })
        animeworldResults.push(...res)
      }

      // Assert - AnimeWorld should return results
      assert.isArray(animeworldResults)
      assert.isNotEmpty(animeworldResults, `Should find results using titles ${candidateTitles.join(', ')}`)

      const metadataSyncService = new MetadataSyncService()
      const parsedResults = await metadataSyncService.parseAnimeWorldResults(animeworldResults, {
        hasValidAirDate: true,
        startDate: season.from,
        endDate: season.to
      }, 'sub')

      // Check if expected results are found
      const foundIdentifiers = parsedResults.map((r) => r.animeworldIdentifier)
      logger.info(`\nExpected identifiers: ${season.expectedResults.join(', ')}`)
      logger.info(`Found identifiers: ${foundIdentifiers.join(', ')}`)

      assert.isTrue(foundIdentifiers.toSorted().join(',') == season.expectedResults.toSorted().join(','), `Should find all expected identifiers for ${season.title}`)
    }
  }).timeout(120000)

  test('search all seasons of Re:Zero on AnimeWorld', async ({ assert }) => {
    const animeworldService = new AnimeworldService()
    const candidateTitles = [
      'Re: ZERO, Starting Life in Another World',
      'ReZero kara Hajimeru Isekai Seikatsu',
      'Re:ZERO -Starting Life in Another World-',
      'Re Zero kara Hajimeru Isekai Seikatsu',
      'Re:Zero kara Hajimeru Isekai Seikatsu',
      'Re: Zero Kara Hajimeru Isekai Seikatsu',
    ]

    logger.info(`\n=== Re:Zero Season-by-Season Search ===$`)

    const metadataSyncService = new MetadataSyncService()

    for (const season of rezeroSeasons) {
      logger.info(`\n--- Testing: ${season.title} (${season.from}-${season.to}) ---`)

      // Extract years from UTC dates
      const fromDate = new Date(season.from)
      const toDate = new Date(season.to)
      const years: number[] = []
      for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year++) {
        years.push(year)
      }

      // Search on AnimeWorld with year filter
      const animeworldResults = []
      const candidateTitlesCopy = [...candidateTitles]
      while (animeworldResults.length === 0 && candidateTitlesCopy.length > 0) {
        const sonarrName = candidateTitlesCopy.shift()!
        const res = await animeworldService.searchAnimeWithFilter({
          keyword: sonarrName,
          type: [FilterType.Anime, FilterType.Ona],
          dub: FilterDub.Sub,
          seasonYear: years,
        })
        animeworldResults.push(...res)
      }

      const parsedResults = await metadataSyncService.parseAnimeWorldResults(animeworldResults, {
        hasValidAirDate: true,
        startDate: season.from,
        endDate: season.to
      }, 'sub')

      // Assert - AnimeWorld should return results
      assert.isArray(animeworldResults)
      assert.isNotEmpty(animeworldResults, `Should find results using titles ${candidateTitles.join(', ')}`)

      // Check if expected results are found
      const foundIdentifiers = parsedResults.map((r) => r.animeworldIdentifier)

      assert.isTrue(foundIdentifiers.toSorted().join(',') == season.expectedResults.toSorted().join(','), `Should find all expected identifiers for ${season.title}`)

    }

  }).tags(['@anime'], 'append').timeout(120000)

  test("search My Hero Academia: World Heroes' Mission movie on AnimeWorld", async ({ assert }) => {
    const animeworldService = new AnimeworldService()
    const candidateTitles = [
      "My Hero Academia: World Heroes' Mission",
      "Boku no Hero Academia THE MOVIE: World Heroes' Mission",
    ]

    logger.info(`\n=== My Hero Academia Movie Search ===$`)
    logger.info(`\n--- Testing: ${myHeroAcademiaMovie.title} (${myHeroAcademiaMovie.from}-${myHeroAcademiaMovie.to}) ---`)

    // Extract years from UTC dates
    const fromDate = new Date(myHeroAcademiaMovie.from)
    const toDate = new Date(myHeroAcademiaMovie.to)
    const years: number[] = []
    for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year++) {
      years.push(year)
    }

    // Search on AnimeWorld with year filter and Movie type
    const animeworldResults = []
    const candidateTitlesCopy = [...candidateTitles]
    while (animeworldResults.length === 0 && candidateTitlesCopy.length > 0) {
      const sonarrName = candidateTitlesCopy.shift()!
      const res = await animeworldService.searchAnimeWithFilter({
        keyword: sonarrName,
        type: [FilterType.Movie],
        dub: FilterDub.Dub,
        seasonYear: years,
      })
      animeworldResults.push(...res)
    }

    // Assert - AnimeWorld should return results
    assert.isArray(animeworldResults)
    assert.isNotEmpty(animeworldResults, `Should find results using titles ${candidateTitles.join(', ')}`)

    const metadataSyncService = new MetadataSyncService()
    const parsedResults = await metadataSyncService.parseAnimeWorldResults(animeworldResults, {
      hasValidAirDate: true,
      startDate: myHeroAcademiaMovie.from,
      endDate: myHeroAcademiaMovie.to
    }, 'dub')

    // Check if expected results are found
    const foundIdentifiers = parsedResults.map((r) => r.animeworldIdentifier)
    logger.info(`\nExpected identifiers: ${myHeroAcademiaMovie.expectedResults.join(', ')}`)
    logger.info(`Found identifiers: ${foundIdentifiers.join(', ')}`)

    assert.isTrue(foundIdentifiers.toSorted().join(',') == myHeroAcademiaMovie.expectedResults.toSorted().join(','), `Should find expected identifier for ${myHeroAcademiaMovie.title}`)
  }).tags(['@movies'], 'append').timeout(120000)
  
})

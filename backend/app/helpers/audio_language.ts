import type { CheerioAPI } from 'cheerio'

/**
 * A language as Sonarr/Radarr identify it
 */
export interface ArrLanguage {
  id: number
  name: string
}

/**
 * AnimeWorld language codes (the "language" filter values) mapped to Sonarr/Radarr languages.
 * Language ids are fixed in the Sonarr/Radarr source, but shared by both only up to 25
 * (Arabic is 26 in Sonarr and 31 in Radarr): a language above it needs one id per service.
 */
const ARR_LANGUAGES: Record<string, ArrLanguage> = {
  en: { id: 1, name: 'English' },
  fr: { id: 2, name: 'French' },
  it: { id: 5, name: 'Italian' },
  jp: { id: 8, name: 'Japanese' },
  ch: { id: 10, name: 'Chinese' },
  kr: { id: 21, name: 'Korean' },
}

/**
 * Label of the audio in the info block of an AnimeWorld page ("Audio:"),
 * also without the colon or with different spacing/case
 */
const AUDIO_LABEL = /^\s*audio\s*:?\s*$/i

/**
 * Read the audio language of an AnimeWorld entry from its page:
 * the info block has "Audio:" followed by a link to /filter?language=<code>
 * @param $ - The loaded anime page
 * @returns The AnimeWorld language code ("jp", "it", ...), or null if not shown
 */
export function parseAnimeworldAudioLanguage($: CheerioAPI): string | null {
  let language: string | null = null
  $('dt').each((_, element) => {
    if (!AUDIO_LABEL.test($(element).text())) {
      return
    }
    const href = $(element).next('dd').find('a').attr('href') ?? ''
    const match = href.match(/[?&]language=([a-z]+)/i)
    if (match) {
      language = match[1].toLowerCase()
      return false
    }
  })
  return language
}

/**
 * The Sonarr/Radarr language of an AnimeWorld audio language code
 * @returns null when the code is missing or not mapped, to leave the language detected by Sonarr/Radarr
 */
export function toArrLanguage(language: string | null | undefined): ArrLanguage | null {
  if (!language || !Object.hasOwn(ARR_LANGUAGES, language)) {
    return null
  }
  return ARR_LANGUAGES[language]
}

export type DownloadErrorData = (
  | {
      mediaType: 'episode'
      seriesTitle: string
      seasonNumber: number
      episodeNumber: number
      episodeTitle: string
    }
  | {
      mediaType: 'film'
      filmTitle: string
      year: number | null
    }
) & { error: string }

export default class DownloadErrorEvent {
  constructor(public data: DownloadErrorData) {}
}

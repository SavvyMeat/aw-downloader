export type DownloadSuccessData =
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

export default class DownloadSuccessEvent {
  constructor(public data: DownloadSuccessData) {}
}

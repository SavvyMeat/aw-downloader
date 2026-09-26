/**
 * Preloaded into AW by compose.sandbox.yaml (NODE_OPTIONS=--import=...), no backend change needed.
 *
 * AW scrapes AnimeWorld with "got" and downloads the video files with the default "axios"
 * instance. When SANDBOX_FAKE_DOWNLOADS is enabled, every axios request for a video file is
 * redirected to SANDBOX_FAKE_DOWNLOAD_URL: searches and download-link extraction still hit the
 * real AnimeWorld, but the file actually downloaded is the small fixture video.
 */
const enabled = !['false', '0', 'no', 'off'].includes(
  (process.env.SANDBOX_FAKE_DOWNLOADS ?? 'true').trim().toLowerCase()
)
const fakeUrl = process.env.SANDBOX_FAKE_DOWNLOAD_URL

// Only the application server: skip "node ace migration:run" and other commands
const isServer = process.argv[1]?.endsWith('bin/server.js')

const VIDEO_FILE = /\.(mp4|mkv|avi|m4v|webm)$/i

if (isServer && !enabled) {
  console.log('[sandbox] SANDBOX_FAKE_DOWNLOADS disattivato: vengono scaricati i file reali')
} else if (isServer) {
  if (!fakeUrl) {
    throw new Error('[sandbox] SANDBOX_FAKE_DOWNLOAD_URL is required when SANDBOX_FAKE_DOWNLOADS is enabled')
  }

  // Same module URL the app resolves "axios" to, so this is the very same default instance
  const { default: axios } = await import('file:///app/node_modules/axios/index.js')

  axios.interceptors.request.use((config) => {
    const url = new URL(config.url, config.baseURL)
    if (VIDEO_FILE.test(url.pathname) && url.href !== fakeUrl) {
      console.log(`[sandbox] download reindirizzato: ${url.href} -> ${fakeUrl}`)
      config.url = fakeUrl
      config.baseURL = undefined
    }
    return config
  })

  console.log(`[sandbox] SANDBOX_FAKE_DOWNLOADS attivo: i file video vengono scaricati da ${fakeUrl}`)
}

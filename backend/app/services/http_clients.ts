import axios from 'axios'
import baseGot from 'got'

/**
 * Compressions accepted from remote servers. Brotli is left out on purpose:
 * it reduces how much third-party data goes through the Brotli decoder
 * (see CVE-2026-111497).
 */
export const ACCEPT_ENCODING = 'gzip, deflate'

// Set on the default axios instance (not a new one), so code that hooks into
// it, like the sandbox download redirect, keeps working
axios.defaults.headers.common['Accept-Encoding'] = ACCEPT_ENCODING

export { axios }

export const got = baseGot.extend({
  headers: { 'accept-encoding': ACCEPT_ENCODING },
})

/**
 * Minimal JSON client for the AW, Sonarr and Radarr APIs used by the sandbox tests
 */
export function createClient(baseUrl, headers = {}) {
  async function request(method, path, body) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${method} ${baseUrl}${path} -> ${response.status} ${text.slice(0, 300)}`)
    }
    return text ? JSON.parse(text) : null
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Call `check` until it returns a truthy value (which is returned) or the timeout expires
 */
export async function waitFor(description, check, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await check()
      if (result) {
        return result
      }
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(
    `Timeout (${timeoutMs / 1000}s) waiting for: ${description}` +
      (lastError ? ` - last error: ${lastError.message}` : '')
  )
}

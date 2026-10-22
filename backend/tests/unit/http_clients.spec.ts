import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import { ACCEPT_ENCODING, axios, got } from '#services/http_clients'

/**
 * Starts a local server that records the headers of the request it receives.
 */
async function withServer(run: (url: string) => Promise<unknown>): Promise<IncomingHttpHeaders> {
  let received: IncomingHttpHeaders = {}
  const server = createServer((req, res) => {
    received = req.headers
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/`)
  } finally {
    server.close()
  }
  return received
}

test.group('HTTP clients', () => {
  test('axios does not ask for Brotli', async ({ assert }) => {
    const headers = await withServer((url) => axios.get(url))
    assert.equal(headers['accept-encoding'], ACCEPT_ENCODING)
  })

  test('got does not ask for Brotli', async ({ assert }) => {
    const headers = await withServer((url) => got.get(url))
    assert.equal(headers['accept-encoding'], ACCEPT_ENCODING)
  })

  test('extended got instances keep the setting', async ({ assert }) => {
    const client = got.extend({ headers: { 'user-agent': 'test' } })
    const headers = await withServer((url) => client.get(url))
    assert.equal(headers['accept-encoding'], ACCEPT_ENCODING)
  })
})

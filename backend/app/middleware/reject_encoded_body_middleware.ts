import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Rejects request bodies sent compressed (gzip, br, ...). The UI never sends
 * them, and the body parser would otherwise decompress them, exposing the
 * Node decoders to anyone who can reach the API (see CVE-2026-111497).
 */
export default class RejectEncodedBodyMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    const encoding = request.header('content-encoding')?.trim().toLowerCase()

    if (encoding && encoding !== 'identity') {
      return response.status(415).send({ message: 'Content-Encoding non supportato' })
    }

    return next()
  }
}

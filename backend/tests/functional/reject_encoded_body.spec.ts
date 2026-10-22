import { test } from '@japa/runner'

test.group('Compressed request bodies', () => {
  for (const encoding of ['br', 'gzip', 'deflate']) {
    test(`rejects Content-Encoding: ${encoding}`, async ({ client }) => {
      const response = await client
        .post('/api/configs')
        .header('content-encoding', encoding)
        .json({})

      response.assertStatus(415)
    })
  }
})

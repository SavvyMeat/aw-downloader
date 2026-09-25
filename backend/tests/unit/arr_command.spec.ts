import { test } from '@japa/runner'
import { waitForCommand } from '../../app/helpers/arr_command.js'

/**
 * Fake status source returning the given statuses in order (the last one repeats)
 */
function statusSequence(statuses: string[]) {
  let calls = 0
  const fetchStatus = async () => statuses[Math.min(calls++, statuses.length - 1)]
  return { fetchStatus, calls: () => calls }
}

const noSleep = async () => {}

test.group('waitForCommand', () => {
  test('returns as soon as the command is completed', async ({ assert }) => {
    const source = statusSequence(['queued', 'started', 'completed'])

    const status = await waitForCommand(source.fetchStatus, { sleep: noSleep })

    assert.equal(status, 'completed')
    assert.equal(source.calls(), 3)
  })

  test('does not wait when the command is already finished', async ({ assert }) => {
    const slept: number[] = []
    const source = statusSequence(['completed'])

    await waitForCommand(source.fetchStatus, { sleep: async (ms) => void slept.push(ms) })

    assert.deepEqual(slept, [])
  })

  test('returns the other final statuses', async ({ assert }) => {
    for (const final of ['failed', 'aborted', 'cancelled', 'orphaned']) {
      const source = statusSequence(['started', final])
      assert.equal(await waitForCommand(source.fetchStatus, { sleep: noSleep }), final)
    }
  })

  test('returns "timeout" when the command never finishes', async ({ assert }) => {
    const source = statusSequence(['started'])

    const status = await waitForCommand(source.fetchStatus, {
      timeoutMs: 5000,
      intervalMs: 1000,
      sleep: noSleep,
    })

    assert.equal(status, 'timeout')
    // One check at 0s plus one after each of the 5 intervals
    assert.equal(source.calls(), 6)
  })

  test('propagates errors while reading the status', async ({ assert }) => {
    await assert.rejects(
      () => waitForCommand(async () => Promise.reject(new Error('boom')), { sleep: noSleep }),
      'boom'
    )
  })
})

/**
 * Final states of a Sonarr/Radarr command (GET /api/v3/command/{id})
 */
const FINAL_COMMAND_STATUSES = ['completed', 'failed', 'aborted', 'cancelled', 'orphaned']

export interface WaitForCommandOptions {
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Poll a Sonarr/Radarr command until it reaches a final state.
 *
 * Commands are queued and executed asynchronously: the POST only returns their id.
 * A RescanSeries/RescanMovie command imports new files inside its execution, so once
 * it is "completed" the imported file is already linked to the episode/movie.
 *
 * @param fetchStatus - Returns the current status of the command
 * @returns The final status, or "timeout" if the command is still running after timeoutMs
 */
export async function waitForCommand(
  fetchStatus: () => Promise<string>,
  { timeoutMs = 120_000, intervalMs = 1_000, sleep = defaultSleep }: WaitForCommandOptions = {}
): Promise<string> {
  let elapsed = 0

  while (true) {
    const status = await fetchStatus()
    if (FINAL_COMMAND_STATUSES.includes(status)) {
      return status
    }

    if (elapsed >= timeoutMs) {
      return 'timeout'
    }

    await sleep(intervalMs)
    elapsed += intervalMs
  }
}

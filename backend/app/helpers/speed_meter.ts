/**
 * Download speed over a moving time window, instead of the average since the start:
 * it follows slowdowns and drops to 0 when no data arrives
 */
export class SpeedMeter {
  private total = 0
  private samples: Array<{ time: number; bytes: number }>

  constructor(
    private readonly windowMs: number,
    now: number = Date.now()
  ) {
    this.samples = [{ time: now, bytes: 0 }]
  }

  /** Count bytes received from the network */
  add(bytes: number): void {
    this.total += bytes
  }

  /** Bytes per second received over the last window (or since the start, if shorter) */
  speed(now: number = Date.now()): number {
    this.samples.push({ time: now, bytes: this.total })

    // Keep the newest sample that is at least one window old, as the starting point
    while (this.samples.length > 2 && this.samples[1].time <= now - this.windowMs) {
      this.samples.shift()
    }

    const oldest = this.samples[0]
    const elapsedSeconds = (now - oldest.time) / 1000
    return elapsedSeconds > 0 ? (this.total - oldest.bytes) / elapsedSeconds : 0
  }
}

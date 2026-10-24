// Notices when the app's asynchronous file work stops answering, and asks for a restart.
//
// Seen on macOS: after hours of running, every asynchronous file call in the main process (the
// heartbeat, panel requests, catalog writes) stopped completing while timers, the window and the
// menu bar carried on. The panel then said the Hub wasn't running while the Hub said it was.
// The cause sits inside Electron; this keeps the engine from staying in that state.

export interface IoWatchdogDeps {
  /** A tiny asynchronous file call; it settles within milliseconds when all is well. */
  probe(): Promise<unknown>
  /** Called once when a probe hasn't settled for `stallAfterMs`. */
  onStall(stalledForMs: number): void
  /** How often to look. */
  intervalMs?: number
  /** How long a probe may take before the engine counts as stuck. */
  stallAfterMs?: number
  now?: () => number
}

export const IO_WATCHDOG_INTERVAL_MS = 15_000
export const IO_STALL_AFTER_MS = 45_000

export class IoWatchdog {
  private probeStartedAt: number | null = null
  private fired = false
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: IoWatchdogDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), this.deps.intervalMs ?? IO_WATCHDOG_INTERVAL_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One look: start a probe, or, while one is still out, check how long it has been. */
  tick(): void {
    if (this.fired) return
    const now = this.now()
    if (this.probeStartedAt !== null) {
      const waited = now - this.probeStartedAt
      if (waited >= (this.deps.stallAfterMs ?? IO_STALL_AFTER_MS)) {
        this.fired = true
        this.stop()
        this.deps.onStall(waited)
      }
      return
    }
    this.probeStartedAt = now
    const settled = (): void => {
      this.probeStartedAt = null
    }
    this.deps.probe().then(settled, settled)
  }
}

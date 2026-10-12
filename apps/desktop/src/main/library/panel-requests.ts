import { watch, type FSWatcher } from 'fs'
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import {
  MAX_REQUEST_BYTES,
  parseRequest,
  REQUESTS_FOLDER,
  type PanelRequest,
  type RequestResult
} from '@catalog/requests'

/** Carries out requests (RequestHandler in the app) and publishes their results (engine.json). */
export interface PanelRequestTarget {
  handle(id: string, request: PanelRequest): Promise<RequestResult>
  /** The result for a file that was too big or wasn't a valid request. */
  unreadable(id: string): RequestResult
  report(result: RequestResult): void
}

/**
 * A request file this young may still be being written by the panel; read it next round. The
 * panel writes each (tiny) request in one call, so this only has to cover that one write.
 */
export const SETTLE_MS = 100
/** How often the requests folder is listed (a cheap readdir), so sound previews start quickly. */
export const POLL_MS = 250
/** A file that doesn't parse yet gets this long to be completed before it counts as broken. */
const UNREADABLE_GRACE_MS = 1000

/**
 * Picks up requests the Premiere panel drops in `<catalog>/requests/` (add a folder, set a
 * favorite, import files…), one at a time in name order. Each file is deleted before it's acted
 * on, so a bad request can never loop, and every one gets a result (by file name) in engine.json.
 */
export class PanelRequests {
  private timer: NodeJS.Timeout | null = null
  private soon: NodeJS.Timeout | null = null
  private watcher: FSWatcher | null = null
  private busy = false
  private again = false
  private stopped = false

  constructor(
    private readonly catalogDir: string,
    private readonly target: PanelRequestTarget,
    private readonly intervalMs = POLL_MS,
    private readonly now: () => number = Date.now
  ) {}

  get dir(): string {
    return join(this.catalogDir, REQUESTS_FOLDER)
  }

  start(): void {
    void mkdir(this.dir, { recursive: true })
      .then(() => this.watch())
      .catch(() => undefined)
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
    void this.poll()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.soon) clearTimeout(this.soon)
    this.watcher?.close()
    this.timer = null
    this.soon = null
    this.watcher = null
  }

  /** Picks up a new request as soon as it has settled instead of at the next poll. */
  private watch(): void {
    if (this.stopped || this.watcher) return
    try {
      this.watcher = watch(this.dir, () => {
        if (this.stopped || this.soon) return
        this.soon = setTimeout(() => {
          this.soon = null
          void this.poll()
        }, SETTLE_MS + 10)
      })
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null // polling carries on
      })
    } catch {
      // Not supported here (some network drives): polling alone still works.
    }
  }

  /** Handles every waiting request once. Returns how many got a result. */
  async poll(): Promise<number> {
    if (this.stopped) return 0
    if (this.busy) {
      this.again = true
      return 0
    }
    this.busy = true
    let handled = 0
    try {
      const names = (await readdir(this.dir).catch(() => [] as string[]))
        .filter((name) => name.endsWith('.json'))
        .sort()
      for (const name of names) {
        if (this.stopped) break
        const file = join(this.dir, name)
        let request: PanelRequest | null = null
        try {
          const info = await stat(file)
          const age = this.now() - info.mtimeMs
          if (!info.isFile() || age < SETTLE_MS) continue
          if (info.size <= MAX_REQUEST_BYTES) {
            request = parseRequest(await readFile(file, 'utf8'))
            // Possibly caught mid-write: give it a moment before calling it broken.
            if (!request && age < UNREADABLE_GRACE_MS) continue
          }
        } catch {
          continue
        }
        try {
          await rm(file, { force: true })
        } catch {
          continue // Still open in the panel (Windows); next round.
        }
        if (this.stopped) break
        const id = name.slice(0, -'.json'.length)
        const result = request ? await this.target.handle(id, request) : this.target.unreadable(id)
        if (this.stopped) break
        this.target.report(result)
        handled++
      }
    } finally {
      this.busy = false
    }
    // A request arrived while this round was busy (e.g. a sound preview during an import).
    if (this.again && !this.stopped) {
      this.again = false
      handled += await this.poll()
    }
    return handled
  }
}

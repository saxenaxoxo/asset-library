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

/** A request file this young may still be being written by the panel; read it next round. */
const SETTLE_MS = 250

/**
 * Picks up requests the Premiere panel drops in `<catalog>/requests/` (add a folder, set a
 * favorite, import files…), one at a time in name order. Each file is deleted before it's acted
 * on, so a bad request can never loop, and every one gets a result (by file name) in engine.json.
 */
export class PanelRequests {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private stopped = false

  constructor(
    private readonly catalogDir: string,
    private readonly target: PanelRequestTarget,
    private readonly intervalMs = 1000,
    private readonly now: () => number = Date.now
  ) {}

  get dir(): string {
    return join(this.catalogDir, REQUESTS_FOLDER)
  }

  start(): void {
    void mkdir(this.dir, { recursive: true }).catch(() => undefined)
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
    void this.poll()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Handles every waiting request once. Returns how many got a result. */
  async poll(): Promise<number> {
    if (this.busy || this.stopped) return 0
    this.busy = true
    let handled = 0
    try {
      const names = (await readdir(this.dir).catch(() => [] as string[]))
        .filter((name) => name.endsWith('.json'))
        .sort()
      for (const name of names) {
        if (this.stopped) break
        const file = join(this.dir, name)
        let text: string | null = null
        try {
          const info = await stat(file)
          if (!info.isFile() || this.now() - info.mtimeMs < SETTLE_MS) continue
          if (info.size <= MAX_REQUEST_BYTES) text = await readFile(file, 'utf8')
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
        const request = text === null ? null : parseRequest(text)
        const result = request ? await this.target.handle(id, request) : this.target.unreadable(id)
        if (this.stopped) break
        this.target.report(result)
        handled++
      }
    } finally {
      this.busy = false
    }
    return handled
  }
}

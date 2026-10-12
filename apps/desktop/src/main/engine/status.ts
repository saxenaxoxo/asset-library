import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  ENGINE_HEARTBEAT_MS,
  ENGINE_STATUS_FILE,
  type EngineStatus,
  type RequestResult
} from '@catalog/requests'
import { writeFileAtomic } from '../catalog/atomic-file'

/** engine.json keeps this many recent request results. */
export const MAX_RESULTS = 20
/** Summing the media cache walks a folder of thousands of files; do it at most this often. */
const CACHE_SIZE_MAX_AGE_MS = 60_000

/** Where the status comes from. Plain functions, so tests can feed it anything. */
export interface StatusSource {
  version: string
  importsFolder: string
  mediaDir: string
  indexing(): { rootIds: number[]; filesSeen: number }
  pendingMedia(): number
  startAtLogin(): boolean
  /** `updatedAt` of the last catalog written, or null before the first one. */
  catalogUpdatedAt?(): number | null
}

/** Total size of the files directly inside `dir` (the media cache is flat). */
export async function folderBytes(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[])
  let total = 0
  for (const name of names) {
    try {
      const info = await stat(join(dir, name))
      if (info.isFile()) total += info.size
    } catch {
      // Deleted while we looked.
    }
  }
  return total
}

/**
 * Rewrites `<catalog>/engine.json` every few seconds so the Premiere panel knows the engine is
 * alive, what it's doing and how its recent requests went. Writes are atomic and never overlap.
 */
export class EngineStatusWriter {
  private readonly results: RequestResult[] = []
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> | null = null
  private again = false
  private stopped = false
  private cacheBytes = 0
  private cacheMeasuredAt = -Infinity
  private listeners: ((status: EngineStatus) => void)[] = []

  constructor(
    private readonly catalogDir: string,
    private readonly source: StatusSource,
    private readonly intervalMs = ENGINE_HEARTBEAT_MS,
    private readonly now: () => number = Date.now
  ) {}

  get file(): string {
    return join(this.catalogDir, ENGINE_STATUS_FILE)
  }

  start(): void {
    this.timer = setInterval(() => void this.write(), this.intervalMs)
    void this.write()
  }

  /** Call on quit, before the database closes: the status reads from it. */
  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Called with every status written (the tray shows it). */
  onStatus(listener: (status: EngineStatus) => void): void {
    this.listeners.push(listener)
  }

  /** Records a request's outcome and publishes it right away, so the panel isn't kept waiting. */
  record(result: RequestResult): void {
    this.results.push(result)
    if (this.results.length > MAX_RESULTS) this.results.splice(0, this.results.length - MAX_RESULTS)
    void this.write()
  }

  /** The cache size is measured again on the next write (after it's been cleared). */
  invalidateCacheSize(): void {
    this.cacheMeasuredAt = -Infinity
  }

  async status(): Promise<EngineStatus> {
    if (this.now() - this.cacheMeasuredAt >= CACHE_SIZE_MAX_AGE_MS) {
      this.cacheMeasuredAt = this.now()
      this.cacheBytes = await folderBytes(this.source.mediaDir)
    }
    return {
      version: this.source.version,
      updatedAt: this.now(),
      indexing: this.source.indexing(),
      pendingMedia: this.source.pendingMedia(),
      settings: { startAtLogin: this.source.startAtLogin() },
      cacheBytes: this.cacheBytes,
      importsFolder: this.source.importsFolder,
      results: [...this.results],
      ...(this.source.catalogUpdatedAt?.() != null
        ? { catalogUpdatedAt: this.source.catalogUpdatedAt() as number }
        : {})
    }
  }

  /** Writes engine.json now (or right after the write in progress). Never throws. */
  async write(): Promise<void> {
    if (this.stopped) return
    if (this.writing) {
      this.again = true
      return this.writing
    }
    this.writing = (async () => {
      try {
        const status = await this.status()
        if (this.stopped) return
        await writeFileAtomic(this.catalogDir, ENGINE_STATUS_FILE, JSON.stringify(status))
        for (const listener of this.listeners) listener(status)
      } catch {
        // A missed beat is harmless; the next one retries.
      }
    })()
    try {
      await this.writing
    } finally {
      this.writing = null
    }
    if (this.again) {
      this.again = false
      await this.write()
    }
  }
}

/** The tray's one-line summary: "Indexing 120 files…", "Making previews (12 left)", "Up to date". */
export function statusLine(status: Pick<EngineStatus, 'indexing' | 'pendingMedia'>): string {
  if (status.indexing.rootIds.length > 0) {
    const n = status.indexing.filesSeen
    return n > 0
      ? `Indexing ${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}…`
      : 'Indexing…'
  }
  if (status.pendingMedia > 0) {
    return `Making previews (${status.pendingMedia.toLocaleString('en-US')} left)`
  }
  return 'Up to date'
}

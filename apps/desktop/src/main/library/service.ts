import { stat } from 'fs/promises'
import { basename } from 'path'
import type { LibraryRepository } from './repository'
import type { RootRecord, ScanProgress } from '@shared/library'
import { parseProbe } from '../media/probe'
import type { MediaBinaries } from '../media/binaries'
import { WorkerError, type WorkerClient } from '../worker/client'
import { mediaPlan } from '../media/plan'
import { buildCatalog, writeCatalog } from '../catalog/writer'

export type LibraryEvent =
  { type: 'scan-progress'; progress: ScanProgress } | { type: 'library-changed' }

const PROBE_BATCH = 24
const PROBE_CONCURRENCY = 2
const CHANGE_THROTTLE_MS = 400
const MEDIA_BATCH = 8
const CATALOG_DEBOUNCE_MS = 1500

/**
 * Coordinates the library: scans roots in the worker, records results, probes media details,
 * and tells the UI what changed. All database access goes through the repository.
 */
export class LibraryService {
  private readonly scanning = new Set<number>()
  private probing = false
  private changeTimer: NodeJS.Timeout | null = null
  private generating = false
  private catalogTimer: NodeJS.Timeout | null = null
  /** Set on quit. After this, late results from the worker are ignored: the database is closing. */
  private stopped = false

  constructor(
    private readonly repo: LibraryRepository,
    private readonly worker: WorkerClient,
    private readonly binaries: MediaBinaries,
    private readonly paths: { mediaDir: string; catalogDir: string; appVersion: string },
    private readonly emit: (event: LibraryEvent) => void
  ) {}

  /** Call before closing the database: cancels pending timers and ignores late worker results. */
  stop(): void {
    this.stopped = true
    if (this.changeTimer) clearTimeout(this.changeTimer)
    if (this.catalogTimer) clearTimeout(this.catalogTimer)
    this.changeTimer = null
    this.catalogTimer = null
  }

  /** Call once at start-up: tidies up after a crash, then refreshes every root in the background. */
  start(): void {
    this.repo.recoverInterruptedScans()
    for (const root of this.repo.listRoots()) void this.rescan(root.id)
    void this.probePending()
    this.scheduleCatalog()
  }

  async addRoot(path: string): Promise<RootRecord> {
    const info = await stat(path)
    if (!info.isDirectory()) throw new Error('Choose a folder, not a file.')
    const root = this.repo.addRoot(path, basename(path) || path)
    this.notifyChanged()
    void this.rescan(root.id)
    return root
  }

  removeRoot(id: number): void {
    this.repo.removeRoot(id)
    this.notifyChanged()
  }

  /** Call after favorites or tags change so the panel's catalog stays current. */
  organizingChanged(): void {
    this.notifyChanged()
  }

  rescanAll(): void {
    for (const root of this.repo.listRoots()) void this.rescan(root.id)
  }

  /** Scans one root. A second request while it's already scanning is ignored. */
  async rescan(rootId: number): Promise<void> {
    const root = this.repo.getRoot(rootId)
    if (!root || this.scanning.has(rootId)) return
    this.scanning.add(rootId)
    const scanId = this.repo.startScan(rootId)
    let filesSeen = 0
    this.emitProgress({ rootId, state: 'scanning', filesSeen })
    try {
      await this.worker.request(
        {
          type: 'scan',
          rootPath: root.path,
          exclusions: this.repo.listExclusions(rootId),
          known: this.repo.knownFiles(rootId)
        },
        (entries) => {
          if (this.stopped) return
          this.repo.applyScanBatch(rootId, scanId, entries)
          filesSeen += entries.length
          this.emitProgress({ rootId, state: 'scanning', filesSeen })
          this.notifyChanged()
        }
      )
      if (this.stopped) return
      const summary = this.repo.finishScan(rootId, scanId)
      this.emitProgress({ rootId, state: 'done', ...summary })
      void this.probePending()
    } catch (error) {
      if (this.stopped) return
      this.repo.abortScan(scanId)
      if (error instanceof WorkerError && error.code === 'root-unavailable') {
        this.repo.setRootStatus(rootId, 'offline')
        this.emitProgress({
          rootId,
          state: 'offline',
          filesSeen,
          message: `${root.label} isn't available. Connect the drive, then rescan.`
        })
      } else {
        this.emitProgress({
          rootId,
          state: 'failed',
          filesSeen,
          message: `Scanning ${root.label} stopped: ${(error as Error).message}`
        })
      }
    } finally {
      this.scanning.delete(rootId)
      this.notifyChanged()
    }
  }

  /** Reads media details (dimensions, duration, codec, alpha) for files that need them. */
  async probePending(): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      while (!this.stopped) {
        const batch = this.repo.pendingProbes(PROBE_BATCH)
        if (batch.length === 0) break
        const queue = [...batch]
        const workers = Array.from({ length: PROBE_CONCURRENCY }, async () => {
          for (let job = queue.shift(); job; job = queue.shift()) {
            try {
              if (job.kind === 'template') continue
              const json = await this.worker.request({
                type: 'probe',
                ffprobePath: this.binaries.ffprobe,
                path: job.path
              })
              if (this.stopped) return
              this.repo.saveProbe(job.id, parseProbe(json, job.kind))
            } catch {
              if (this.stopped) return
              this.repo.saveProbeError(
                job.id,
                "Couldn't read this file's media details. It may be damaged or still downloading."
              )
            }
          }
        })
        await Promise.all(workers)
        this.notifyChanged()
      }
    } finally {
      this.probing = false
    }
    if (!this.stopped) void this.generateMedia()
  }

  /** Generates thumbnails, scrub sprites, previews and waveforms, one asset at a time. */
  async generateMedia(): Promise<void> {
    if (this.generating) return
    this.generating = true
    try {
      while (!this.stopped) {
        const batch = this.repo.pendingMedia(MEDIA_BATCH)
        if (batch.length === 0) break
        for (const asset of batch) {
          try {
            const base = `${asset.id}-${asset.key}`
            const jobs = mediaPlan({
              ...asset,
              input: asset.path,
              base,
              platform: process.platform
            })
            const files = await this.worker.request({
              type: 'media',
              ffmpegPath: this.binaries.ffmpeg,
              outDir: this.paths.mediaDir,
              jobs
            })
            if (this.stopped) return
            this.repo.saveMedia(asset.id, asset.key, {
              thumb: files.thumb ?? null,
              sprite: files.sprite ?? null,
              preview: files.preview ?? null,
              wave: files.wave ?? null
            })
          } catch {
            if (this.stopped) return
            this.repo.saveMediaError(asset.id)
          }
        }
        this.notifyChanged()
      }
    } finally {
      this.generating = false
    }
  }

  /** Rewrites the panel's catalog shortly after the library settles. */
  private scheduleCatalog(): void {
    if (this.stopped) return
    if (this.catalogTimer) clearTimeout(this.catalogTimer)
    this.catalogTimer = setTimeout(() => {
      this.catalogTimer = null
      if (this.stopped) return
      try {
        const catalog = buildCatalog(this.repo, this.paths.mediaDir, this.paths.appVersion)
        writeCatalog(this.paths.catalogDir, catalog).catch(() => undefined)
      } catch {
        // A failed catalog write must never take the app down; the next change retries it.
      }
    }, CATALOG_DEBOUNCE_MS)
  }

  private emitProgress(progress: ScanProgress): void {
    this.emit({ type: 'scan-progress', progress })
  }

  /** Coalesces bursts of changes (scan batches, probes) into one UI refresh. */
  private notifyChanged(): void {
    if (this.stopped || this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      if (this.stopped) return
      this.emit({ type: 'library-changed' })
      this.scheduleCatalog()
    }, CHANGE_THROTTLE_MS)
  }
}

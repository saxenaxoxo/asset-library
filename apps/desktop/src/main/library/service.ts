import { readdir, rm, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { LibraryRepository } from './repository'
import type { PendingMedia } from './types'
import type { RootRecord, ScanProgress } from '@shared/library'
import { parseProbe } from '../media/probe'
import type { MediaBinaries } from '../media/binaries'
import { WorkerError, type WorkerClient } from '../worker/client'
import { externalPreviewPlan, mediaPlan } from '../media/plan'
import { buildCatalog, writeCatalog } from '../catalog/writer'

export type LibraryEvent =
  { type: 'scan-progress'; progress: ScanProgress } | { type: 'library-changed' }

const PROBE_BATCH = 24
const PROBE_CONCURRENCY = 2
const CHANGE_THROTTLE_MS = 400
const PROGRESS_THROTTLE_MS = 250
const MEDIA_BATCH = 12
const MEDIA_CONCURRENCY = 3
const CATALOG_DEBOUNCE_MS = 1500
/** Favorites and tags changed by hand show up in the panel this fast, even while indexing. */
const CATALOG_URGENT_MS = 300
/** The catalog is rewritten at most this often while the library keeps changing (indexing). */
const CATALOG_MIN_INTERVAL_MS = 10_000
/** Cached media younger than this is never cleaned up: it may belong to a job still running. */
const MEDIA_CLEANUP_GRACE_MS = 10 * 60 * 1000

function isCrash(error: unknown): boolean {
  return error instanceof WorkerError && error.code === 'crashed'
}

/**
 * Coordinates the library: scans roots in the worker, records results, probes media details,
 * and tells the UI what changed. All database access goes through the repository.
 */
export class LibraryService {
  /** Running scans, so removing a root can stop its scan. */
  private readonly scanning = new Map<number, AbortController>()
  private readonly lastProgress = new Map<number, number>()
  /** Files seen so far by each running scan, for the engine status and the tray. */
  private readonly filesSeen = new Map<number, number>()
  /** Roots to scan once more when their current scan ends (files were added meanwhile). */
  private readonly rescanAgain = new Set<number>()
  /** Bumped when the media cache is cleared, so a job that started before is thrown away. */
  private mediaEpoch = 0
  private probing = false
  private changeTimer: NodeJS.Timeout | null = null
  private generating = false
  private catalogTimer: NodeJS.Timeout | null = null
  private catalogWriting: Promise<void> | null = null
  private catalogDirty = false
  private catalogUrgent = false
  private lastCatalogAt = 0
  private lastCatalogUpdatedAt: number | null = null
  private cleaning = false
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

  /** `updatedAt` of the last catalog this engine wrote (the panel's cue to re-read it). */
  catalogUpdatedAt(): number | null {
    return this.lastCatalogUpdatedAt
  }

  /** Call once at start-up: tidies up after a crash, then refreshes every root in the background. */
  start(): void {
    this.repo.recoverInterruptedScans()
    this.repo.retryMissingThumbnails()
    for (const root of this.repo.listRoots()) void this.rescan(root.id)
    void this.probePending()
    this.scheduleCatalog()
    void this.cleanupMedia()
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
    this.scanning.get(id)?.abort()
    this.repo.removeRoot(id)
    this.notifyChanged()
    void this.cleanupMedia()
  }

  /** Call after favorites or tags change so the panel's catalog stays current. */
  organizingChanged(): void {
    this.notifyChanged()
    this.scheduleCatalog(true)
  }

  rescanAll(): void {
    for (const root of this.repo.listRoots()) void this.rescan(root.id)
  }

  /** Library folders being scanned right now, and the files seen so far across them. */
  indexing(): { rootIds: number[]; filesSeen: number } {
    let filesSeen = 0
    for (const count of this.filesSeen.values()) filesSeen += count
    return { rootIds: [...this.scanning.keys()].sort((a, b) => a - b), filesSeen }
  }

  /**
   * Scans one root. A second request while it's already scanning is ignored, unless `again` is
   * set (files were just copied in): then the root is scanned once more when the scan ends.
   */
  async rescan(rootId: number, again = false): Promise<void> {
    const root = this.repo.getRoot(rootId)
    if (!root) return
    if (this.scanning.has(rootId)) {
      if (again) this.rescanAgain.add(rootId)
      return
    }
    const abort = new AbortController()
    this.scanning.set(rootId, abort)
    const scanId = this.repo.startScan(rootId)
    let filesSeen = 0
    this.filesSeen.set(rootId, 0)
    // The root can be removed while its scan runs; after that its results go nowhere.
    const gone = (): boolean => this.stopped || abort.signal.aborted || !this.repo.hasRoot(rootId)
    this.emitProgress({ rootId, state: 'scanning', filesSeen }, true)
    try {
      const result = await this.worker.request(
        {
          type: 'scan',
          rootPath: root.path,
          exclusions: this.repo.listExclusions(rootId),
          known: this.repo.knownFiles(rootId)
        },
        (entries) => {
          if (gone()) return
          this.repo.applyScanBatch(rootId, scanId, entries)
          filesSeen += entries.length
          this.filesSeen.set(rootId, filesSeen)
          this.emitProgress({ rootId, state: 'scanning', filesSeen })
          this.notifyChanged()
        },
        abort.signal
      )
      if (gone()) return
      if (!result.complete) {
        // Some folders couldn't be listed. Keep what was found but don't mark anything missing.
        this.repo.abortScan(scanId)
        this.emitProgress(
          {
            rootId,
            state: 'failed',
            filesSeen,
            message: `Some folders in ${root.label} couldn't be read, so they weren't checked. Rescan to try again.`
          },
          true
        )
      } else {
        const summary = this.repo.finishScan(rootId, scanId)
        this.emitProgress({ rootId, state: 'done', ...summary }, true)
      }
      void this.probePending()
    } catch (error) {
      if (gone()) return
      this.repo.abortScan(scanId)
      if (error instanceof WorkerError && error.code === 'root-unavailable') {
        this.repo.setRootStatus(rootId, 'offline')
        this.emitProgress(
          {
            rootId,
            state: 'offline',
            filesSeen,
            message: `${root.label} isn't available. Connect the drive, then rescan.`
          },
          true
        )
      } else {
        this.emitProgress(
          {
            rootId,
            state: 'failed',
            filesSeen,
            message: `Scanning ${root.label} stopped: ${(error as Error).message}`
          },
          true
        )
      }
    } finally {
      if (this.scanning.get(rootId) === abort) {
        this.scanning.delete(rootId)
        this.filesSeen.delete(rootId)
      }
      this.lastProgress.delete(rootId)
      this.notifyChanged()
      if (this.rescanAgain.delete(rootId) && !this.stopped && this.repo.hasRoot(rootId)) {
        void this.rescan(rootId)
      }
    }
  }

  /** Reads media details (dimensions, duration, codec, alpha) for files that need them. */
  async probePending(): Promise<void> {
    if (this.probing) return
    this.probing = true
    let crashed = false
    try {
      while (!this.stopped && !crashed) {
        const batch = this.repo.pendingProbes(PROBE_BATCH)
        if (batch.length === 0) break
        const queue = [...batch]
        const workers = Array.from({ length: PROBE_CONCURRENCY }, async () => {
          for (let job = queue.shift(); job && !crashed; job = queue.shift()) {
            if (job.kind === 'template') continue
            try {
              const json = await this.worker.request({
                type: 'probe',
                ffprobePath: this.binaries.ffprobe,
                path: job.path
              })
              if (this.stopped) return
              this.repo.saveProbe(job.id, job.fingerprint, parseProbe(json, job.kind))
            } catch (error) {
              if (this.stopped) return
              // A worker crash says nothing about this file: leave it pending for the next run.
              if (isCrash(error)) {
                crashed = true
                return
              }
              this.repo.saveProbeError(
                job.id,
                job.fingerprint,
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

  /** Generates thumbnails, scrub sprites and waveforms, a few assets at a time. */
  async generateMedia(): Promise<void> {
    if (this.generating) return
    this.generating = true
    let generated = 0
    try {
      while (!this.stopped) {
        const batch = this.repo.pendingMedia(MEDIA_BATCH)
        if (batch.length === 0) break
        // A few assets at a time: each FFmpeg job is mostly waiting on the disk.
        const queue = [...batch]
        let crashed = false
        const lane = async (): Promise<void> => {
          for (let asset = queue.shift(); asset && !crashed; asset = queue.shift()) {
            const ok = await this.makeMedia(asset)
            if (ok === 'crashed') crashed = true
            else if (ok === 'made') generated++
            if (this.stopped) return
          }
        }
        await Promise.all(Array.from({ length: MEDIA_CONCURRENCY }, lane))
        if (this.stopped) return
        if (crashed) break
        this.notifyChanged()
      }
    } finally {
      this.generating = false
    }
    // Regenerated assets leave their old files behind; sweep once the queue is drained.
    if (generated > 0 && !this.stopped) void this.cleanupMedia()
  }

  /** Thumbnail, scrub strip and waveform for one asset. Never throws. */
  private async makeMedia(
    asset: PendingMedia
  ): Promise<'made' | 'failed' | 'crashed' | 'stale' | 'stopped'> {
    const epoch = this.mediaEpoch
    try {
      const base = `${asset.id}-${asset.key}`
      const jobs = mediaPlan({
        ...asset,
        input: asset.path,
        base,
        platform: process.platform,
        previews: false
      })
      let files =
        jobs.length > 0
          ? await this.worker.request({
              type: 'media',
              ffmpegPath: this.binaries.ffmpeg,
              outDir: this.paths.mediaDir,
              jobs
            })
          : {}
      if (this.stopped) return 'stopped'
      // Nothing we could render (templates, PSDs): use Premiere Composer's preview if any.
      if (!files.thumb && asset.externalPreview) {
        const borrowed = await this.borrowPreview(asset.externalPreview, base)
        if (this.stopped) return 'stopped'
        files = {
          ...files,
          thumb: borrowed.thumb ?? null,
          sprite: files.sprite ?? borrowed.sprite ?? null
        }
      }
      // The cache was cleared while this ran: its files may be gone. It's made again.
      if (epoch !== this.mediaEpoch) return 'stale'
      this.repo.saveMedia(asset.id, asset.key, {
        thumb: files.thumb ?? null,
        sprite: files.sprite ?? null,
        preview: files.preview ?? null,
        wave: files.wave ?? null
      })
      return 'made'
    } catch (error) {
      if (this.stopped) return 'stopped'
      if (isCrash(error)) return 'crashed'
      if (epoch !== this.mediaEpoch) return 'stale'
      this.repo.saveMediaError(asset.id, asset.key)
      return 'failed'
    }
  }

  /** Makes our thumbnail (and scrub strip) from a Premiere Composer preview, if there is one. */
  private async borrowPreview(
    path: string,
    base: string
  ): Promise<{ thumb?: string | null; sprite?: string | null }> {
    try {
      const info = await stat(path)
      if (!info.isFile()) return {}
      const probe = parseProbe(
        await this.worker.request({ type: 'probe', ffprobePath: this.binaries.ffprobe, path }),
        'image'
      )
      if (!probe.width || !probe.height) return {}
      return await this.worker.request({
        type: 'media',
        ffmpegPath: this.binaries.ffmpeg,
        outDir: this.paths.mediaDir,
        jobs: externalPreviewPlan({ input: path, base, width: probe.width, height: probe.height })
      })
    } catch {
      return {} // no preview there, or it couldn't be read: the asset just has no thumbnail
    }
  }

  /**
   * Empties the media cache folder (thumbnails, sprites, previews, waveforms) and queues all of
   * them to be generated again. Only ever touches the app's own media cache folder.
   */
  async clearMedia(): Promise<{ removed: number; bytes: number }> {
    this.mediaEpoch++
    this.repo.resetAllMedia()
    let removed = 0
    let bytes = 0
    const names = await readdir(this.paths.mediaDir).catch(() => [] as string[])
    for (const name of names) {
      const path = join(this.paths.mediaDir, name)
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        await rm(path, { force: true })
        removed++
        bytes += info.size
      } catch {
        // Locked or already gone; the regular cleanup sweeps it later.
      }
    }
    if (this.stopped) return { removed, bytes }
    this.notifyChanged()
    this.scheduleCatalog(true)
    void this.generateMedia()
    return { removed, bytes }
  }

  /**
   * Deletes cached media that no asset refers to any more (removed folders, changed files).
   * Only ever touches the app's own media cache folder.
   */
  async cleanupMedia(): Promise<number> {
    if (this.cleaning || this.stopped) return 0
    this.cleaning = true
    let removed = 0
    try {
      const names = await readdir(this.paths.mediaDir).catch(() => [] as string[])
      if (this.stopped) return 0
      const referenced = this.repo.referencedMediaFiles()
      const cutoff = Date.now() - MEDIA_CLEANUP_GRACE_MS
      for (const name of names) {
        if (this.stopped) break
        if (referenced.has(name)) continue
        const path = join(this.paths.mediaDir, name)
        try {
          const info = await stat(path)
          if (!info.isFile() || info.mtimeMs > cutoff) continue
          await rm(path, { force: true })
          removed++
        } catch {
          // Already gone or locked; the next sweep tries again.
        }
      }
    } finally {
      this.cleaning = false
    }
    return removed
  }

  /**
   * Rewrites the panel's catalog once the library settles, at most every few seconds while it
   * keeps changing, and never two writes at once. `urgent` (a change the user just made by hand)
   * skips the wait.
   */
  private scheduleCatalog(urgent = false): void {
    if (this.stopped) return
    if (this.catalogWriting) {
      this.catalogDirty = true
      this.catalogUrgent ||= urgent
      return
    }
    if (this.catalogTimer) {
      if (!urgent) return
      clearTimeout(this.catalogTimer)
    }
    const wait = urgent
      ? CATALOG_URGENT_MS
      : Math.max(CATALOG_DEBOUNCE_MS, this.lastCatalogAt + CATALOG_MIN_INTERVAL_MS - Date.now())
    this.catalogTimer = setTimeout(() => {
      this.catalogTimer = null
      if (this.stopped) return
      this.lastCatalogAt = Date.now()
      try {
        const catalog = buildCatalog(this.repo, this.paths.mediaDir, this.paths.appVersion)
        this.catalogWriting = writeCatalog(this.paths.catalogDir, catalog)
          .then(() => {
            this.lastCatalogUpdatedAt = catalog.updatedAt
          })
          .catch(() => undefined)
          .finally(() => {
            this.catalogWriting = null
            if (this.catalogDirty) {
              const urgentNext = this.catalogUrgent
              this.catalogDirty = false
              this.catalogUrgent = false
              this.scheduleCatalog(urgentNext)
            }
          })
      } catch {
        // A failed catalog build must never take the app down; the next change retries it.
      }
    }, wait)
  }

  /** Scan progress for the status bar; "scanning" updates are throttled per root. */
  private emitProgress(progress: ScanProgress, force = false): void {
    const now = Date.now()
    if (!force && now - (this.lastProgress.get(progress.rootId) ?? 0) < PROGRESS_THROTTLE_MS) return
    this.lastProgress.set(progress.rootId, now)
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

import { stat } from 'fs/promises'
import { basename } from 'path'
import type { LibraryRepository } from './repository'
import type { RootRecord, ScanProgress } from '@shared/library'
import { parseProbe } from '../media/probe'
import type { MediaBinaries } from '../media/binaries'
import { WorkerError, type WorkerClient } from '../worker/client'

export type LibraryEvent =
  { type: 'scan-progress'; progress: ScanProgress } | { type: 'library-changed' }

const PROBE_BATCH = 24
const PROBE_CONCURRENCY = 2
const CHANGE_THROTTLE_MS = 400

/**
 * Coordinates the library: scans roots in the worker, records results, probes media details,
 * and tells the UI what changed. All database access goes through the repository.
 */
export class LibraryService {
  private readonly scanning = new Set<number>()
  private probing = false
  private changeTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly repo: LibraryRepository,
    private readonly worker: WorkerClient,
    private readonly binaries: MediaBinaries,
    private readonly emit: (event: LibraryEvent) => void
  ) {}

  /** Call once at start-up: tidies up after a crash, then refreshes every root in the background. */
  start(): void {
    this.repo.recoverInterruptedScans()
    for (const root of this.repo.listRoots()) void this.rescan(root.id)
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
          this.repo.applyScanBatch(rootId, scanId, entries)
          filesSeen += entries.length
          this.emitProgress({ rootId, state: 'scanning', filesSeen })
          this.notifyChanged()
        }
      )
      const summary = this.repo.finishScan(rootId, scanId)
      this.emitProgress({ rootId, state: 'done', ...summary })
      void this.probePending()
    } catch (error) {
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
      for (;;) {
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
              this.repo.saveProbe(job.id, parseProbe(json, job.kind))
            } catch {
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
  }

  private emitProgress(progress: ScanProgress): void {
    this.emit({ type: 'scan-progress', progress })
  }

  /** Coalesces bursts of changes (scan batches, probes) into one UI refresh. */
  private notifyChanged(): void {
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.emit({ type: 'library-changed' })
    }, CHANGE_THROTTLE_MS)
  }
}

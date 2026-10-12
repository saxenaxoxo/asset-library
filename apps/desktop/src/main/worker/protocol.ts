import type { ScanEntry } from '../library/types'
import type { MediaJob } from '../media/plan'
import type { CatalogPublishResult } from '../catalog/writer'

/** Messages between the main process and the utility (worker) process. */
export type WorkerRequest =
  | { id: number; type: 'ffprobe-version'; ffprobePath: string }
  | {
      id: number
      type: 'scan'
      rootPath: string
      exclusions: string[]
      known: Record<string, { size: number; mtime: number; fingerprint: string | null }>
    }
  | { id: number; type: 'probe'; ffprobePath: string; path: string }
  | { id: number; type: 'media'; ffmpegPath: string; outDir: string; jobs: MediaJob[] }
  /** Stops a running scan early; the scan then resolves with what it found so far. */
  | { id: number; type: 'cancel'; target: number }
  /**
   * Writes the panel's catalog (full or delta) from a read-only connection to the library
   * database, so building and serializing a large catalog never blocks the main process.
   */
  | {
      id: number
      type: 'catalog'
      dbFile: string
      catalogDir: string
      mediaDir: string
      appVersion: string
      full: boolean
    }

/** What each request type resolves to. */
export interface WorkerResults {
  'ffprobe-version': string
  scan: { filesSeen: number; complete: boolean }
  /** Raw ffprobe JSON; parsed in main so parsing stays unit-testable. */
  probe: string
  /** Generated file name per output, or null where generation failed. */
  media: Partial<Record<MediaJob['output'], string | null>>
  cancel: true
  catalog: CatalogPublishResult
}

/** `crashed`: the worker died mid-request, so the request says nothing about the file. */
export type WorkerErrorCode = 'root-unavailable' | 'failed' | 'crashed'

export type WorkerResponse =
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: string; code: WorkerErrorCode }

/** Unsolicited progress from a running request. */
export type WorkerEvent = { kind: 'scan-batch'; requestId: number; entries: ScanEntry[] }

export type WorkerMessage = WorkerResponse | WorkerEvent

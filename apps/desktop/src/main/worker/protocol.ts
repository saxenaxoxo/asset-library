import type { ScanEntry } from '../library/types'

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

/** What each request type resolves to. */
export interface WorkerResults {
  'ffprobe-version': string
  scan: { filesSeen: number }
  /** Raw ffprobe JSON; parsed in main so parsing stays unit-testable. */
  probe: string
}

export type WorkerErrorCode = 'root-unavailable' | 'failed'

export type WorkerResponse =
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: string; code: WorkerErrorCode }

/** Unsolicited progress from a running request. */
export type WorkerEvent = { kind: 'scan-batch'; requestId: number; entries: ScanEntry[] }

export type WorkerMessage = WorkerResponse | WorkerEvent

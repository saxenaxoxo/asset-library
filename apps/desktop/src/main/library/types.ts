import type { AssetKind } from '@shared/library'

export type { AssetKind, AssetQuery, AssetRecord, AssetSort, RootRecord } from '@shared/library'

/** One file reported by the scanner. */
export interface ScanEntry {
  relPath: string
  filename: string
  size: number
  mtimeMs: number
  /** null when the file couldn't be read (still downloading, locked, permission denied). */
  fingerprint: string | null
  error?: string
}

export interface ScanSummary {
  filesSeen: number
  added: number
  moved: number
  missing: number
}

/** Media details read by FFprobe. Unknown values stay null; nothing is guessed. */
export interface ProbeResult {
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  codec: string | null
  hasAlpha: boolean | null
  channels: number | null
  sampleRate: number | null
}

export interface MediaFiles {
  thumb: string | null
  sprite: string | null
  preview: string | null
  wave: string | null
}

export interface PendingMedia {
  id: string
  path: string
  kind: AssetKind
  hasAlpha: boolean | null
  durationMs: number | null
  width: number | null
  height: number | null
  /** Short content key; changes when the file changes, so cached media is never stale. */
  key: string
  /** Where Premiere Composer would keep this file's preview (may not exist). */
  externalPreview: string | null
}

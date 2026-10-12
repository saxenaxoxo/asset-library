import { createHash } from 'crypto'
import type { Dir } from 'fs'
import { open, opendir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import { kindForFile } from '@shared/media-types'
import type { ScanEntry } from '../library/types'

/** Folders that are never indexed (OS/system/trash/caches). Hidden (dot) entries are skipped too. */
const SKIPPED_DIRECTORIES = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'node_modules',
  '__MACOSX',
  'Adobe Premiere Pro Auto-Save',
  'Adobe Premiere Pro Video Previews',
  'Adobe Premiere Pro Audio Previews',
  'Media Cache',
  'Media Cache Files',
  // Premiere Composer / Mister Horse keeps its own preview renders here.
  '_Mister Horse Previews'
])

const FINGERPRINT_CHUNK = 64 * 1024

/**
 * size + first and last 64 KB. Cheap even on huge files, and stable across renames and moves,
 * which is all move detection needs.
 */
export async function fingerprintFile(path: string, size: number): Promise<string> {
  const hash = createHash('sha1')
  hash.update(String(size))
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(FINGERPRINT_CHUNK, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > FINGERPRINT_CHUNK * 2) {
      const tail = Buffer.alloc(FINGERPRINT_CHUNK)
      await handle.read(tail, 0, tail.length, size - FINGERPRINT_CHUNK)
      hash.update(tail)
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

export interface ScanOptions {
  rootPath: string
  /** Relative folder paths (with "/" separators) to skip, including everything inside. */
  exclusions: readonly string[]
  known: Readonly<Record<string, { size: number; mtime: number; fingerprint: string | null }>>
  onBatch: (entries: ScanEntry[]) => void
  batchSize?: number
  shouldStop?: () => boolean
}

export class RootUnavailableError extends Error {}

export interface ScanResult {
  filesSeen: number
  /**
   * False when part of the tree couldn't be listed or the scan was stopped early. An incomplete
   * scan must never mark unseen files as missing.
   */
  complete: boolean
}

/** Normalizes a path relative to the root to forward slashes, the format stored in the DB. */
export function toRelPath(rootPath: string, fullPath: string): string {
  return relative(rootPath, fullPath).split(sep).join('/')
}

export function isExcluded(relPath: string, exclusions: readonly string[]): boolean {
  return exclusions.some((ex) => relPath === ex || relPath.startsWith(`${ex}/`))
}

/**
 * Walks a library root and reports every supported file in batches. Never follows symlinks,
 * so a root can't lead the scanner elsewhere on disk. Throws RootUnavailableError if the root
 * itself can't be read (drive unplugged, folder renamed), so the caller can mark it offline
 * instead of concluding that every file vanished.
 */
export async function scanRoot(options: ScanOptions): Promise<ScanResult> {
  const { rootPath, exclusions, known, onBatch } = options
  const batchSize = options.batchSize ?? 250
  try {
    const rootStat = await stat(rootPath)
    if (!rootStat.isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new RootUnavailableError(`Can't open ${rootPath}: ${(error as Error).message}`)
  }

  let batch: ScanEntry[] = []
  let seen = 0
  let complete = true
  const flush = (): void => {
    if (batch.length === 0) return
    onBatch(batch)
    batch = []
  }

  const pending: string[] = [rootPath]
  while (pending.length > 0) {
    if (options.shouldStop?.()) {
      complete = false
      break
    }
    const dirPath = pending.pop() as string
    let dir
    try {
      dir = await opendir(dirPath)
    } catch {
      continue // unreadable sub-folder: skip it, keep scanning the rest
    }
    try {
      await scanDirectory(dir, dirPath)
    } catch {
      // The folder became unreadable mid-listing (flaky drive, NAS hiccup): keep what we have.
      // If the whole root vanished, the final check below reports it.
      complete = false
    }
  }
  flush()
  // Re-check the root: if the drive vanished mid-scan, the results are incomplete.
  try {
    await stat(rootPath)
  } catch (error) {
    throw new RootUnavailableError(`Lost access to ${rootPath}: ${(error as Error).message}`)
  }
  return { filesSeen: seen, complete }

  async function scanDirectory(dir: Dir, dirPath: string): Promise<void> {
    for await (const entry of dir) {
      if (options.shouldStop?.()) {
        complete = false
        return
      }
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dirPath, entry.name)
      const relPath = toRelPath(rootPath, fullPath)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !isExcluded(relPath, exclusions)) {
          pending.push(fullPath)
        }
        continue
      }
      if (!entry.isFile() || !kindForFile(entry.name) || isExcluded(relPath, exclusions)) continue

      seen++
      try {
        const info = await stat(fullPath)
        const mtimeMs = Math.floor(info.mtimeMs)
        const previous = known[relPath]
        const unchanged = previous && previous.size === info.size && previous.mtime === mtimeMs
        const fingerprint = unchanged
          ? previous.fingerprint
          : await fingerprintFile(fullPath, info.size)
        batch.push({ relPath, filename: entry.name, size: info.size, mtimeMs, fingerprint })
      } catch (error) {
        batch.push({
          relPath,
          filename: entry.name,
          size: 0,
          mtimeMs: 0,
          fingerprint: null,
          error: `Couldn't read this file: ${(error as Error).message}`
        })
      }
      if (batch.length >= batchSize) flush()
    }
  }
}

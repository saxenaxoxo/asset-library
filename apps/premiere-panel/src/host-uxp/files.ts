// Reading the catalog and media from disk. UXP's file APIs differ between hosts and versions,
// so each read tries the documented options in order and remembers what worked.
import { catalogPath, parseCatalog, type Catalog } from '@catalog/types'
import { detectWindows, storage } from './platform'
import { fileUrl, homeFromDataFolder } from '../paths'

const uxp = require('uxp')
const fs = require('fs')
const lfs = uxp.storage.localFileSystem
const CUSTOM_CATALOG_TOKEN = 'assetLibrary.catalogToken'
const WINDOWS = detectWindows()

async function readWithFs(path: string): Promise<string> {
  try {
    return (await fs.readFile(path, { encoding: 'utf-8' })) as string
  } catch {
    return (await fs.readFile(fileUrl(path), { encoding: 'utf-8' })) as string
  }
}

async function readWithEntry(path: string): Promise<string> {
  const entry = await lfs.getEntryWithUrl(fileUrl(path))
  return (await entry.read({ format: uxp.storage.formats.utf8 })) as string
}

/** Reads a UTF-8 text file by absolute path (needs the fullAccess permission). */
export async function readText(path: string): Promise<string> {
  try {
    return await readWithFs(path)
  } catch {
    return readWithEntry(path)
  }
}

/** Modification time in ms, or null if the file can't be checked (caller falls back to polling). */
/** A time from whatever shape this host's file API returns (ms number, Date, or string). */
function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  if (value && typeof (value as Date).getTime === 'function') return (value as Date).getTime()
  return null
}

export async function modifiedTime(path: string): Promise<number | null> {
  try {
    const info = (await fs.lstat(path)) as Record<string, unknown>
    const ms = toMs(info['mtimeMs']) ?? toMs(info['mtime'])
    if (ms !== null) return ms
  } catch {
    // try the entry API
  }
  try {
    const entry = (await lfs.getEntryWithUrl(fileUrl(path))) as unknown as {
      getMetadata?: () => Promise<{ dateModified?: unknown }>
    }
    return toMs((await entry.getMetadata?.())?.dateModified)
  } catch {
    return null
  }
}

/** True when nothing exists at `path` (as opposed to a file this host can't check). */
export async function fileMissing(path: string): Promise<boolean> {
  try {
    await readText(path)
    return false
  } catch (error) {
    const text = String((error as Error)?.message ?? error).toLowerCase()
    return /not ?found|no such file|enoent|does not exist|cannot find/.test(text)
  }
}

async function homeFolder(): Promise<string | null> {
  try {
    const home = require('os').homedir?.()
    if (home) return home
  } catch {
    // os module not available in this host
  }
  try {
    return homeFromDataFolder((await lfs.getDataFolder()).nativePath)
  } catch {
    return null
  }
}

/** Where to read the catalog: a location the user chose, or the desktop app's default. */
export async function locateCatalog(): Promise<string | null> {
  const token = storage.get(CUSTOM_CATALOG_TOKEN)
  if (token) {
    try {
      return (await lfs.getEntryForPersistentToken(token)).nativePath
    } catch {
      storage.remove(CUSTOM_CATALOG_TOKEN)
    }
  }
  const home = await homeFolder()
  return home ? catalogPath(WINDOWS ? 'win32' : 'darwin', home) : null
}

/** Lets the user point the panel at catalog.json by hand, and remembers the choice. */
export async function chooseCatalog(): Promise<string | null> {
  const picked = await lfs.getFileForOpening({ types: ['json'] })
  const entry = Array.isArray(picked) ? picked[0] : picked
  if (!entry) return null
  try {
    storage.set(CUSTOM_CATALOG_TOKEN, await lfs.createPersistentToken(entry))
  } catch {
    // Can't remember the choice; it still works for this session.
  }
  return entry.nativePath
}

/** Splits an absolute path into its folder and file name (either separator). */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: path.slice(0, cut), name: path.slice(cut + 1) }
}

/** Joins a folder and a name with the folder's own separator. */
export function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`
}

/** Creates a folder (and its parents) if it doesn't exist. Never throws. */
export async function ensureFolder(path: string): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true })
  } catch {
    // Already there, or this host has no mkdir; the write below reports a real problem.
  }
}

/** Writes a UTF-8 text file by absolute path, trying each file API this host might have. */
export async function writeText(path: string, text: string): Promise<void> {
  try {
    await fs.writeFile(path, text, { encoding: 'utf-8' })
    return
  } catch {
    // try the next API
  }
  try {
    await fs.writeFile(fileUrl(path), text, { encoding: 'utf-8' })
    return
  } catch {
    // try the next API
  }
  const { dir, name } = splitPath(path)
  const folder = await lfs.getEntryWithUrl(fileUrl(dir))
  const file = await folder.createFile(name, { overwrite: true })
  await file.write(text, { format: uxp.storage.formats.utf8 })
}

/** Deletes a file the panel wrote. Quiet when it's already gone. */
export async function deleteFile(path: string): Promise<void> {
  try {
    await fs.unlink(path)
    return
  } catch {
    // try the entry API
  }
  try {
    const entry = await lfs.getEntryWithUrl(fileUrl(path))
    await entry.delete()
  } catch {
    // already gone, or not ours to delete
  }
}

/** Lets the editor pick a folder. Returns its path, or null if they cancelled. */
export async function pickFolder(): Promise<string | null> {
  const folder = await lfs.getFolder()
  return folder ? (folder.nativePath as string) : null
}

/** Lets the editor pick one or more files. Returns their paths (empty if they cancelled). */
export async function pickFiles(): Promise<string[]> {
  const picked = await lfs.getFileForOpening({ allowMultiple: true })
  if (!picked) return []
  const list = (Array.isArray(picked) ? picked : [picked]) as { nativePath: string }[]
  return list.map((entry) => entry.nativePath)
}

export async function loadCatalog(path: string): Promise<Catalog> {
  let text: string
  try {
    text = await readText(path)
  } catch {
    throw new Error("Couldn't read your library's catalog. Try again, or choose it in Settings.")
  }
  return parseCatalog(text)
}

/** Most fallback blob URLs kept alive at once; the least recently shown are revoked first. */
const BLOB_CACHE_MAX = 300
/** Blob URLs by path, oldest first (a Map keeps insertion order, so re-inserting marks "recent"). */
const blobUrls = new Map<string, string>()
const blobReads = new Map<string, Promise<string>>()
/** Set once a file: URL failed but reading the bytes worked: skip file: URLs from then on. */
let fileUrlsRefused = false
/** The file each image element was last asked to show, so a slow read can't overwrite a newer one. */
const imageTargets = new WeakMap<HTMLImageElement, string>()

function cachedBlob(path: string): string | undefined {
  const url = blobUrls.get(path)
  if (url) {
    blobUrls.delete(path)
    blobUrls.set(path, url)
  }
  return url
}

function rememberBlob(path: string, url: string): void {
  blobUrls.set(path, url)
  for (const [oldPath, oldUrl] of blobUrls) {
    if (blobUrls.size <= BLOB_CACHE_MAX) break
    blobUrls.delete(oldPath)
    URL.revokeObjectURL(oldUrl)
  }
}

/** One read per path at a time, however many images ask for it. */
function blobFor(path: string, mime: string): Promise<string> {
  const cached = cachedBlob(path)
  if (cached) return Promise.resolve(cached)
  let read = blobReads.get(path)
  if (!read) {
    read = fs
      .readFile(path)
      .then((data) => {
        const url = URL.createObjectURL(new Blob([data as ArrayBuffer], { type: mime }))
        rememberBlob(path, url)
        return url
      })
      .finally(() => blobReads.delete(path))
    blobReads.set(path, read)
  }
  return read
}

/**
 * Shows a local image. Tries a file: URL first (fastest); if the host refuses it, reads the
 * bytes and uses a blob URL instead. Fallback blobs are cached per path (bounded, see above).
 */
export function showLocalImage(img: HTMLImageElement, path: string, mime: string): void {
  imageTargets.set(img, path)
  img.onerror = null
  const showBlob = (afterFileUrlFailed: boolean): void => {
    blobFor(path, mime)
      .then((url) => {
        if (afterFileUrlFailed) fileUrlsRefused = true
        // The element may have been pointed at another file meanwhile.
        if (imageTargets.get(img) === path) img.src = url
      })
      .catch(() => img.classList.add('broken'))
  }
  const cached = cachedBlob(path)
  if (cached) {
    img.src = cached
  } else if (fileUrlsRefused) {
    showBlob(false)
  } else {
    img.onerror = () => {
      img.onerror = null
      showBlob(true)
    }
    img.src = fileUrl(path)
  }
}

export function mimeFor(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.m4a')) return 'audio/mp4'
  return 'image/jpeg'
}

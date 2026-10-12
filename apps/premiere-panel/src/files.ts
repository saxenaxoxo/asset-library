// Reading the catalog and media from disk. UXP's file APIs differ between hosts and versions,
// so each read tries the documented options in order and remembers what worked.
import { catalogPath, parseCatalog, type Catalog } from '@catalog/types'
import { fileUrl, homeFromDataFolder } from './paths'

const uxp = require('uxp')
const fs = require('fs')
const lfs = uxp.storage.localFileSystem
const CUSTOM_CATALOG_TOKEN = 'assetLibrary.catalogToken'
const WINDOWS = navigator.platform.toLowerCase().startsWith('win')

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
export async function modifiedTime(path: string): Promise<number | null> {
  try {
    const info = await fs.lstat(path)
    return info.mtimeMs ?? info.mtime?.getTime() ?? null
  } catch {
    return null
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
  const token = localStorage.getItem(CUSTOM_CATALOG_TOKEN)
  if (token) {
    try {
      return (await lfs.getEntryForPersistentToken(token)).nativePath
    } catch {
      localStorage.removeItem(CUSTOM_CATALOG_TOKEN)
    }
  }
  const home = await homeFolder()
  return home ? catalogPath(WINDOWS ? 'win32' : 'darwin', home) : null
}

/** Lets the user point the panel at catalog.json by hand, and remembers the choice. */
export async function chooseCatalog(): Promise<string | null> {
  const entry = await lfs.getFileForOpening({ types: ['json'] })
  if (!entry) return null
  localStorage.setItem(CUSTOM_CATALOG_TOKEN, await lfs.createPersistentToken(entry))
  return entry.nativePath
}

export async function loadCatalog(path: string): Promise<Catalog> {
  let text: string
  try {
    text = await readText(path)
  } catch {
    throw new Error('No library found yet. Open the Asset Library app and add a folder.')
  }
  return parseCatalog(text)
}

const blobUrls = new Map<string, string>()

/**
 * Shows a local image. Tries a file: URL first (fastest); if the host refuses it, reads the
 * bytes and uses a blob URL instead. Each fallback blob is cached per path.
 */
export function showLocalImage(img: HTMLImageElement, path: string, mime: string): void {
  const cached = blobUrls.get(path)
  if (cached) {
    img.src = cached
    return
  }
  img.onerror = () => {
    img.onerror = null
    fs.readFile(path)
      .then((data) => {
        const url = URL.createObjectURL(new Blob([data as ArrayBuffer], { type: mime }))
        blobUrls.set(path, url)
        img.src = url
      })
      .catch(() => img.classList.add('broken'))
  }
  img.src = fileUrl(path)
}

export function mimeFor(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.m4a')) return 'audio/mp4'
  return 'image/jpeg'
}

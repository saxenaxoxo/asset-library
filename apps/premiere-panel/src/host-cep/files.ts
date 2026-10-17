// Reading the catalog and media from disk with Node, which the CEP runtime provides.
import { plainPath } from '@catalog/requests'
import { catalogPaths, findCatalog, parseCatalog, type Catalog } from '@catalog/types'
import { detectWindows, storage } from './platform'
import { fileUrl } from '../paths'

const fs = require('fs')
const CUSTOM_CATALOG_PATH = 'assetLibrary.catalogPath'
const WINDOWS = detectWindows()
const cep = globalThis as unknown as CepGlobals

/** Reads a UTF-8 text file by absolute path. */
export function readText(path: string): Promise<string> {
  return fs.promises.readFile(path, 'utf8')
}

/** Modification time in ms, or null if the file can't be checked. */
export async function modifiedTime(path: string): Promise<number | null> {
  try {
    return (await fs.promises.stat(path)).mtimeMs
  } catch {
    return null
  }
}

/** True when nothing exists at `path` (as opposed to a file that can't be read). */
export async function fileMissing(path: string): Promise<boolean> {
  try {
    await fs.promises.access(path)
    return false
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT'
  }
}

/** Where to read the catalog: a location the user chose, or the engine's default. */
export async function locateCatalog(): Promise<string | null> {
  const chosen = storage.get(CUSTOM_CATALOG_PATH)
  if (chosen) return chosen
  try {
    return await findCatalog(
      catalogPaths(WINDOWS ? 'win32' : 'darwin', require('os').homedir()),
      fileMissing
    )
  } catch {
    return null
  }
}

function pick(multiple: boolean, directory: boolean, title: string, types: string[]): string[] {
  const dialog = cep.cep?.fs.showOpenDialog(multiple, directory, title, '', types)
  if (!dialog || dialog.err !== 0 || !dialog.data) return []
  // On macOS the picker can answer with file:// URLs; the engine needs plain paths.
  return dialog.data.map(plainPath).filter((path) => path.length > 0)
}

/** Lets the user point the panel at catalog.json by hand, and remembers the choice. */
export async function chooseCatalog(): Promise<string | null> {
  const [path] = pick(false, false, 'Choose your Asset Library catalog (catalog.json)', ['json'])
  if (!path) return null
  storage.set(CUSTOM_CATALOG_PATH, path)
  return path
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
    await fs.promises.mkdir(path, { recursive: true })
  } catch {
    // Already there; the write below reports a real problem.
  }
}

/** Writes a UTF-8 text file by absolute path. */
export function writeText(path: string, text: string): Promise<void> {
  return fs.promises.writeFile(path, text, 'utf8')
}

/** Deletes a file the panel wrote. Quiet when it's already gone. */
export async function deleteFile(path: string): Promise<void> {
  try {
    await fs.promises.unlink(path)
  } catch {
    // already gone, or not ours to delete
  }
}

/** Lets the editor pick a folder. Returns its path, or null if they cancelled. */
export async function pickFolder(): Promise<string | null> {
  return pick(false, true, 'Add a folder to your library', [])[0] ?? null
}

/** Lets the editor pick one or more files. Returns their paths (empty if they cancelled). */
export async function pickFiles(): Promise<string[]> {
  return pick(true, false, 'Import files into the library', [])
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

/** Shows a local image: Chromium loads file: URLs from a panel served from disk. */
export function showLocalImage(img: HTMLImageElement, path: string, mime: string): void {
  void mime // Chromium works the type out itself; the UXP build needs it for blob fallbacks.
  img.onerror = () => img.classList.add('broken')
  img.src = fileUrl(path)
}

export function mimeFor(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.m4a')) return 'audio/mp4'
  return 'image/jpeg'
}

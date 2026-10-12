// Pure path helpers (unit-tested), shared by the file layer and drag-and-drop.

/** Converts a local path to a file:// URI the way Premiere's drag-and-drop expects. */
export function fileUri(path: string): string {
  const normalized = /^[A-Za-z]:\\/.test(path) ? `/${path.replace(/\\/g, '/')}` : path
  return `file://${encodeURI(normalized)}`
}

/** The `file:` URL form UXP uses for <img>/<video> sources and file entries. */
export function fileUrl(path: string): string {
  const normalized = /^[A-Za-z]:\\/.test(path) ? `/${path.replace(/\\/g, '/')}` : path
  return `file:${encodeURI(normalized)}`
}

/**
 * Recovers the user's home folder from the plugin's data folder when the `os` module doesn't
 * offer one. UXP data folders live under ~/Library/... (macOS) or ~\AppData\... (Windows).
 */
export function homeFromDataFolder(dataFolder: string): string | null {
  const mac = dataFolder.indexOf('/Library/')
  if (mac > 0) return dataFolder.slice(0, mac)
  const win = dataFolder.toLowerCase().indexOf('\\appdata\\')
  if (win > 0) return dataFolder.slice(0, win)
  return null
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/m4a',
  aif: 'audio/aif',
  aiff: 'audio/aif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp'
}

/** Content type for Premiere's drag-and-drop payload, or null if Premiere won't accept the file. */
export function dragContentType(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? null : (CONTENT_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null)
}

/** "26.5.2" → 26. */
export function hostMajor(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '0', 10) || 0
}

/** Panel drag-to-timeline is only available from Premiere Pro 27.0. */
export const DRAG_MIN_MAJOR = 27

/** Compares media paths as Premiere may report them (case and slash differences on Windows). */
export function samePath(a: string, b: string, windows: boolean): boolean {
  if (!windows) return a === b
  const norm = (p: string): string => p.replace(/\//g, '\\').toLowerCase()
  return norm(a) === norm(b)
}

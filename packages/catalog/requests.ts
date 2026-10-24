// How the Premiere panel and the background engine talk. The panel can't call the engine
// directly, so both sides exchange small JSON files next to the catalog:
//
//   <catalog folder>/requests/<id>.json   panel → engine. The engine deletes each file before
//                                         acting on it; a file that stays means it isn't running.
//   <catalog folder>/engine.json          engine → panel. Rewritten every few seconds: whether
//                                         the engine is alive, what it's doing, settings, and the
//                                         outcome of recent requests (by request id).

export const REQUESTS_FOLDER = 'requests'
export const ENGINE_STATUS_FILE = 'engine.json'
/** Requests bigger than this are ignored (a real one is well under 1 KB, imports aside). */
export const MAX_REQUEST_BYTES = 64 * 1024
/** How often the engine rewrites engine.json; the panel calls it stopped after 3 missed beats. */
export const ENGINE_HEARTBEAT_MS = 3000
export const ENGINE_STALE_MS = ENGINE_HEARTBEAT_MS * 3 + 1000
/** Opening this URL starts the engine (it registers the scheme when installed). */
export const ENGINE_START_URL = 'assetlibrary://start'

const MAX_FILES = 500
const MAX_PATH = 4096
const MAX_TAG = 64

export type PanelRequest =
  /** Index an existing folder where it is (nothing is copied). */
  | { type: 'add-folder'; path: string }
  /** Forget a library folder. Files on disk are never touched. */
  | { type: 'remove-folder'; rootId: number }
  /** Rescan one library folder, or all of them. */
  | { type: 'rescan'; rootId?: number }
  | { type: 'set-favorite'; id: string; favorite: boolean }
  | { type: 'add-tag'; id: string; tag: string }
  | { type: 'remove-tag'; id: string; tag: string }
  /**
   * Copy files into the library: into `folder` (a path inside library folder `rootId`), or,
   * without a destination, into the engine's Imports folder. Existing files are never
   * overwritten; a copy gets " 2", " 3"… before its extension.
   */
  | { type: 'import-files'; files: string[]; rootId?: number; folder?: string }
  /** `checkForUpdates` was added after the first release; older panels never send it. */
  | { type: 'set-settings'; startAtLogin?: boolean; checkForUpdates?: boolean }
  /** Delete generated thumbnails and previews; they're rebuilt in the background. */
  | { type: 'clear-cache' }
  /** Play an asset's sound through the computer (panels can't play media). */
  | { type: 'play-audio'; id: string }
  | { type: 'stop-audio' }
  /** Uninstall the app from this computer. The engine asks the editor to confirm on screen. */
  | { type: 'uninstall' }

export interface RequestResult {
  /** The request file's name without ".json". */
  id: string
  ok: boolean
  /** Plain-language outcome to show the editor, e.g. "Added SFX Pack". */
  message: string
  at: number
}

export interface EngineStatus {
  version: string
  updatedAt: number
  /** Library folders being scanned right now, and files seen so far across them. */
  indexing: { rootIds: number[]; filesSeen: number }
  /** Assets still waiting for thumbnails or previews. */
  pendingMedia: number
  /** `checkForUpdates` (the daily check for a new release) is omitted by older engines. */
  settings: { startAtLogin: boolean; checkForUpdates?: boolean }
  cacheBytes: number
  /** Where imports without a destination go. */
  importsFolder: string
  /** Newest last, at most 20. */
  results: RequestResult[]
  /**
   * `updatedAt` of the last catalog.json written. The panel re-reads the (possibly large)
   * catalog only when this changes. Older engines omit it.
   */
  catalogUpdatedAt?: number
  /** The full catalog's generation and the delta's seq, so the panel reads only what changed. */
  catalog?: { generation: string; deltaSeq: number }
  /** A newer release of the app, when the update check found one; `url` is its release page. */
  update?: { version: string; url: string }
}

const ASSET_ID = /^[0-9a-f-]{36}$/

const isId = (value: unknown): value is string => typeof value === 'string' && ASSET_ID.test(value)
const isRootId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
/** Decodes `%xx` escapes; a "%" that isn't one (a folder named "50% off") stays as it is. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment.replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
      try {
        return decodeURIComponent(escape)
      } catch {
        return escape
      }
    })
  }
}

/**
 * A path as a folder or file picker reports it, made plain. Adobe's CEP picker can return a
 * `file://` URL with encoded characters (`%20` for a space) instead of a path; this turns
 * `file:///Volumes/My%20Drive` into `/Volumes/My Drive`, `file:///C:/Clips` into `C:/Clips` and
 * `file://server/share` into `//server/share` (a Windows network share). Line breaks around the path go; spaces stay, since a name may end in one.
 */
export function plainPath(raw: string): string {
  let path = raw.trim()
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:/i, '')
    let host = ''
    if (path.startsWith('//')) {
      const slash = path.indexOf('/', 2)
      host = slash === -1 ? path.slice(2) : path.slice(2, slash)
      path = slash === -1 ? '' : path.slice(slash)
      if (host.toLowerCase() === 'localhost') host = ''
    }
    path = path.split('/').map(decodeSegment).join('/')
    if (host) path = `//${decodeSegment(host)}${path}`
    // file:///C:/… has a slash before the drive letter.
    else if (/^\/[A-Za-z]:([\\/]|$)/.test(path)) path = path.slice(1)
  }
  return path
}

/** About how many bytes `JSON.stringify(text)` takes as UTF-8 (escapes counted roughly). */
function jsonBytes(text: string): number {
  let bytes = 2
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x22 || code === 0x5c) bytes += 6
    else if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else bytes += code >= 0xd800 && code < 0xe000 ? 2 : 3
  }
  return bytes + 1
}

/**
 * Splits a big pick of files into import requests the engine accepts: at most 500 files and
 * well under the request size limit each.
 */
export function importBatches(files: readonly string[]): string[][] {
  // Room for the type, the library folder and the folder inside it.
  const budget = MAX_REQUEST_BYTES - MAX_PATH * 2 - 256
  const batches: string[][] = []
  let batch: string[] = []
  let bytes = 0
  for (const file of files) {
    const size = jsonBytes(file)
    if (batch.length > 0 && (batch.length >= MAX_FILES || bytes + size > budget)) {
      batches.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(file)
    bytes += size
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH
const isTag = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TAG

/** Parses a request file, or returns null for anything malformed. Never throws. */
export function parseRequest(text: string): PanelRequest | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  switch (r['type']) {
    case 'add-folder':
      return isPath(r['path']) ? { type: 'add-folder', path: r['path'] } : null
    case 'remove-folder':
      return isRootId(r['rootId']) ? { type: 'remove-folder', rootId: r['rootId'] } : null
    case 'rescan':
      if (r['rootId'] === undefined) return { type: 'rescan' }
      return isRootId(r['rootId']) ? { type: 'rescan', rootId: r['rootId'] } : null
    case 'set-favorite':
      return isId(r['id']) && typeof r['favorite'] === 'boolean'
        ? { type: 'set-favorite', id: r['id'], favorite: r['favorite'] }
        : null
    case 'add-tag':
    case 'remove-tag':
      return isId(r['id']) && isTag(r['tag'])
        ? { type: r['type'], id: r['id'], tag: r['tag'].trim() }
        : null
    case 'import-files': {
      const files = r['files']
      if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) return null
      if (!files.every(isPath)) return null
      const request: PanelRequest = { type: 'import-files', files: files as string[] }
      if (r['rootId'] !== undefined) {
        if (!isRootId(r['rootId'])) return null
        request.rootId = r['rootId']
        const folder = r['folder'] ?? ''
        if (typeof folder !== 'string' || folder.length > MAX_PATH) return null
        request.folder = folder
      }
      return request
    }
    case 'set-settings': {
      const login = r['startAtLogin']
      const updates = r['checkForUpdates']
      if (login !== undefined && typeof login !== 'boolean') return null
      if (updates !== undefined && typeof updates !== 'boolean') return null
      return {
        type: 'set-settings',
        ...(login === undefined ? {} : { startAtLogin: login }),
        ...(updates === undefined ? {} : { checkForUpdates: updates })
      }
    }
    case 'clear-cache':
      return { type: 'clear-cache' }
    case 'play-audio':
      return isId(r['id']) ? { type: 'play-audio', id: r['id'] } : null
    case 'stop-audio':
      return { type: 'stop-audio' }
    case 'uninstall':
      return { type: 'uninstall' }
    default:
      return null
  }
}

/** Parses engine.json, or null if it's missing pieces. Never throws. */
export function parseEngineStatus(text: string): EngineStatus | null {
  try {
    const data = JSON.parse(text) as Partial<EngineStatus>
    if (typeof data.updatedAt !== 'number' || typeof data.version !== 'string') return null
    return {
      version: data.version,
      updatedAt: data.updatedAt,
      indexing: data.indexing ?? { rootIds: [], filesSeen: 0 },
      pendingMedia: data.pendingMedia ?? 0,
      settings: data.settings ?? { startAtLogin: true },
      cacheBytes: data.cacheBytes ?? 0,
      importsFolder: data.importsFolder ?? '',
      results: Array.isArray(data.results) ? data.results : [],
      ...(typeof data.catalogUpdatedAt === 'number'
        ? { catalogUpdatedAt: data.catalogUpdatedAt }
        : {}),
      ...(data.catalog &&
      typeof data.catalog.generation === 'string' &&
      typeof data.catalog.deltaSeq === 'number'
        ? { catalog: { generation: data.catalog.generation, deltaSeq: data.catalog.deltaSeq } }
        : {}),
      ...(data.update &&
      typeof data.update.version === 'string' &&
      typeof data.update.url === 'string'
        ? { update: { version: data.update.version, url: data.update.url } }
        : {})
    }
  } catch {
    return null
  }
}

/** A unique request id, so two quick requests never overwrite each other. */
export function requestId(now: number, random: number): string {
  return `${now}-${Math.floor(random * 1e9).toString(36)}`
}

/** "clip.mov" → "clip 2.mov" → "clip 3.mov": the name an import uses when `name` is taken. */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`
}

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

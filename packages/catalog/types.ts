/** Version of the catalog format shared by the desktop app and the Premiere panel. */
export const CATALOG_VERSION = 1

export type CatalogKind = 'video' | 'audio' | 'image' | 'template'

export interface CatalogAsset {
  id: string
  name: string
  kind: CatalogKind
  /** Absolute path of the original file: what gets imported into the host app. */
  path: string
  folder: string
  root: string
  /** The library folder's ID (added after the first release; older catalogs omit it). */
  rootId?: number
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAlpha: boolean | null
  favorite: boolean
  tags: string[]
  addedAt: number
  /** Absolute paths of generated media in the app's cache, or null. */
  thumb: string | null
  sprite: string | null
  preview: string | null
  wave: string | null
}

export interface Catalog {
  version: number
  updatedAt: number
  /**
   * Identifies this full catalog. Changes after it are written to catalog-delta.json against
   * the same generation, so the panel never re-reads a large catalog for small changes.
   * Older engines omit it.
   */
  generation?: string
  app: string
  /** `path` was added after the first release; older catalogs omit it. */
  roots: { id: number; label: string; online: boolean; path?: string }[]
  tags: string[]
  assets: CatalogAsset[]
}

/** Frames per hover-scrub sprite strip. */
export const SPRITE_FRAMES = 10

/** Where the desktop app writes the catalog, relative to the user's home folder. */
export function catalogPath(platform: 'darwin' | 'win32', home: string): string {
  return platform === 'win32'
    ? `${home}\\AppData\\Roaming\\Asset Library\\catalog\\catalog.json`
    : `${home}/Library/Application Support/Asset Library/catalog/catalog.json`
}

/** Parses and checks a catalog file. Throws a readable error for unknown or broken files. */
export function parseCatalog(json: string): Catalog {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('The library catalog is damaged. Open Asset Library to rebuild it.')
  }
  const catalog = data as Partial<Catalog>
  if (typeof catalog.version !== 'number' || !Array.isArray(catalog.assets)) {
    throw new Error('This file is not an Asset Library catalog.')
  }
  if (catalog.version > CATALOG_VERSION) {
    throw new Error('Your Asset Library app is newer than this panel. Update the panel.')
  }
  return catalog as Catalog
}

/** Changes since the full catalog of the same generation; cumulative, rewritten each time. */
export interface CatalogDelta {
  generation: string
  /** Goes up with every rewrite of the delta file. */
  seq: number
  updatedAt: number
  /** Always the full current lists (they're small). */
  roots: Catalog['roots']
  tags: string[]
  /** Assets added or changed since the full catalog, complete records. */
  upserts: CatalogAsset[]
  /** IDs of assets gone since the full catalog. */
  removes: string[]
}

export const CATALOG_DELTA_FILE = 'catalog-delta.json'

/** Parses a delta file, or null if it's unusable. Never throws. */
export function parseCatalogDelta(json: string): CatalogDelta | null {
  try {
    const data = JSON.parse(json) as Partial<CatalogDelta>
    if (
      typeof data.generation !== 'string' ||
      typeof data.seq !== 'number' ||
      !Array.isArray(data.upserts) ||
      !Array.isArray(data.removes) ||
      !Array.isArray(data.roots)
    )
      return null
    return {
      generation: data.generation,
      seq: data.seq,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      roots: data.roots,
      tags: Array.isArray(data.tags) ? data.tags : [],
      upserts: data.upserts,
      removes: data.removes
    }
  } catch {
    return null
  }
}

/**
 * The current catalog: the full one with its delta applied. Order is kept (new assets go first,
 * as in a fresh catalog). Returns the base unchanged if the delta is for another generation.
 */
export function applyCatalogDelta(base: Catalog, delta: CatalogDelta): Catalog {
  if (!base.generation || delta.generation !== base.generation) return base
  const gone = new Set(delta.removes)
  const changed = new Map(delta.upserts.map((asset) => [asset.id, asset]))
  const assets: CatalogAsset[] = []
  const known = new Set<string>()
  for (const asset of base.assets) {
    known.add(asset.id)
    if (gone.has(asset.id)) continue
    assets.push(changed.get(asset.id) ?? asset)
  }
  const added = delta.upserts.filter((asset) => !known.has(asset.id) && !gone.has(asset.id))
  return {
    ...base,
    updatedAt: delta.updatedAt || base.updatedAt,
    roots: delta.roots,
    tags: delta.tags,
    assets: added.length > 0 ? [...added, ...assets] : assets
  }
}

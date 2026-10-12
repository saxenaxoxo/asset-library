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

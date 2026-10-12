import { randomUUID } from 'crypto'
import { rm } from 'fs/promises'
import nodePath from 'path'
import { writeFileAtomic } from './atomic-file'
import { safeJoin, type CatalogRow } from '../library/repository'
import {
  CATALOG_DELTA_FILE,
  CATALOG_VERSION,
  parseCatalog,
  type Catalog,
  type CatalogAsset
} from '@catalog/types'

export { CATALOG_VERSION } from '@catalog/types'

export const CATALOG_FILE = 'catalog.json'

/** What a catalog is read from: the repository (or anything shaped like it, in tests). */
export interface CatalogSource {
  listRoots(): { id: number; label: string; status: 'ok' | 'offline'; path: string }[]
  listTags(): { name: string }[]
  catalogRows(): CatalogRow[]
}

/** The library as the panel sees it, with each asset already serialized. */
export interface CatalogSnapshot {
  roots: Catalog['roots']
  tags: string[]
  /** Asset IDs, newest first, and their JSON (same positions). */
  ids: string[]
  texts: string[]
}

// Ordinary relative paths ("Pack/SFX/Hit.wav") need no full path resolution. Anything with
// "." or ".." segments, doubled or leading/trailing slashes goes through safeJoin.
const UNUSUAL_REL_PATH = /(^|\/)\.{1,2}(\/|$)|\/\/|^\/|\/$/

/**
 * Joins a root and a relative path with exactly safeJoin's result, but without resolving the
 * path for the common case. Building a 100k-asset catalog spends most of its time here otherwise.
 */
export function rootJoiner(
  rootPath: string,
  path: typeof nodePath = nodePath
): (relPath: string) => string | null {
  const root = path.resolve(rootPath)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const windows = path.sep === '\\'
  return (relPath) => {
    const plain =
      relPath.length > 0 &&
      !UNUSUAL_REL_PATH.test(relPath) &&
      !(windows && (relPath.includes('\\') || relPath.includes(':')))
    if (!plain) return safeJoin(rootPath, relPath, path)
    return prefix + (windows ? relPath.replaceAll('/', '\\') : relPath)
  }
}

/** Reads everything the panel catalog holds. Offline and missing assets are left out. */
export function readCatalogSnapshot(source: CatalogSource, mediaDir: string): CatalogSnapshot {
  const roots = source.listRoots()
  const rootInfo = new Map(
    roots.map((root) => [root.id, { label: root.label, join: rootJoiner(root.path) }])
  )
  const mediaPrefix = nodePath.join(mediaDir, '_').slice(0, -1)
  const media = (name: string | null): string | null =>
    name === null ? null : /[\\/]/.test(name) ? nodePath.join(mediaDir, name) : mediaPrefix + name
  const ids: string[] = []
  const texts: string[] = []
  for (const row of source.catalogRows()) {
    const root = rootInfo.get(row.rootId)
    const path = root ? root.join(row.relPath) : safeJoin(row.rootPath, row.relPath)
    if (!path) continue
    const slash = row.relPath.lastIndexOf('/')
    const asset: CatalogAsset = {
      id: row.id,
      name: row.filename,
      kind: row.kind,
      path,
      folder: slash === -1 ? '' : row.relPath.slice(0, slash),
      root: root?.label ?? '',
      rootId: row.rootId,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      fps: row.fps,
      hasAlpha: row.hasAlpha === null ? null : row.hasAlpha === 1,
      favorite: row.favorite === 1,
      tags: row.tags ? row.tags.split('\u001f') : [],
      addedAt: row.addedAt,
      thumb: media(row.thumb),
      sprite: media(row.sprite),
      preview: media(row.preview),
      wave: media(row.wave)
    }
    ids.push(row.id)
    texts.push(JSON.stringify(asset))
  }
  return {
    roots: roots.map((root) => ({
      id: root.id,
      label: root.label,
      online: root.status === 'ok',
      path: root.path
    })),
    tags: source.listTags().map((tag) => tag.name),
    ids,
    texts
  }
}

/** Builds the catalog that the Premiere panel reads. Offline and missing assets are left out. */
export function buildCatalog(source: CatalogSource, mediaDir: string, appVersion: string): Catalog {
  return parseCatalog(
    fullCatalogText(readCatalogSnapshot(source, mediaDir), appVersion, Date.now())
  )
}

function fullCatalogText(
  snapshot: CatalogSnapshot,
  appVersion: string,
  updatedAt: number,
  generation?: string
): string {
  // Assembled from the per-asset JSON, so a big library is serialized once, not twice.
  return (
    `{"version":${CATALOG_VERSION},"updatedAt":${updatedAt},` +
    (generation === undefined ? '' : `"generation":${JSON.stringify(generation)},`) +
    `"app":${JSON.stringify(appVersion)},"roots":${JSON.stringify(snapshot.roots)},` +
    `"tags":${JSON.stringify(snapshot.tags)},"assets":[${snapshot.texts.join(',')}]}`
  )
}

/** Writes catalog.json atomically (temp file + rename), so the panel never reads half a file. */
export async function writeCatalog(dir: string, catalog: Catalog): Promise<string> {
  return writeFileAtomic(dir, CATALOG_FILE, JSON.stringify(catalog))
}

/** When a full catalog is written instead of a delta. */
export interface CatalogLimits {
  /** More changed assets than this since the full catalog: write a new one. */
  maxChanges: number
  /** …or more than this share of the library. */
  maxFraction: number
  /** A delta older than this is folded into a new full catalog (older panels read only that). */
  maxAgeMs: number
}

export const CATALOG_LIMITS: CatalogLimits = {
  maxChanges: 2000,
  maxFraction: 0.15,
  maxAgeMs: 10 * 60 * 1000
}

export interface CatalogPublishResult {
  /** What was written: catalog.json, catalog-delta.json, or nothing (no change). */
  kind: 'full' | 'delta' | 'unchanged'
  generation: string
  /** 0 right after a full catalog (no delta file); goes up with every delta written. */
  deltaSeq: number
  /** `updatedAt` of the catalog.json on disk. */
  catalogUpdatedAt: number
  assets: number
  /** Assets in the current delta (added, changed or removed since the full catalog). */
  changes: number
}

export interface CatalogPublisherOptions {
  catalogDir: string
  appVersion: string
  limits?: Partial<CatalogLimits>
  now?: () => number
  newGeneration?: () => string
}

/**
 * Writes the panel's catalog: a full catalog.json when needed, otherwise only catalog-delta.json
 * with every change since that full catalog (cumulative, so the panel needs just the latest).
 * Keeps the last full catalog's assets as JSON by ID to tell what changed.
 */
export class CatalogPublisher {
  private generation: string | null = null
  private base = new Map<string, string>()
  private baseAt = 0
  /** The library folders in the full catalog (JSON). */
  private baseRoots = ''
  private seq = 0
  /** The last delta written (without seq and time), or an empty one after a full catalog. */
  private lastBody = ''
  private queue: Promise<unknown> = Promise.resolve()
  private readonly limits: CatalogLimits
  private readonly now: () => number
  private readonly newGeneration: () => string

  constructor(private readonly options: CatalogPublisherOptions) {
    this.limits = { ...CATALOG_LIMITS, ...options.limits }
    this.now = options.now ?? Date.now
    this.newGeneration = options.newGeneration ?? randomUUID
  }

  /** Publishes the library as `read` returns it. `full` forces a new catalog.json. */
  publish(read: () => CatalogSnapshot, full = false): Promise<CatalogPublishResult> {
    const run = this.queue.then(() => this.publishNow(read(), full))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async publishNow(
    snapshot: CatalogSnapshot,
    full: boolean
  ): Promise<CatalogPublishResult> {
    const now = this.now()
    const { catalogDir } = this.options
    if (!full && this.generation !== null) {
      const { upserts, removes } = this.diff(snapshot)
      const changes = upserts.length + removes.length
      const size = Math.max(this.base.size, snapshot.ids.length)
      const tooBig = changes > this.limits.maxChanges || changes > this.limits.maxFraction * size
      const tooOld = changes > 0 && now - this.baseAt >= this.limits.maxAgeMs
      // A folder added, removed, renamed or gone offline: rare, and older panels (which read
      // only catalog.json) should see it at once.
      const rootsChanged = JSON.stringify(snapshot.roots) !== this.baseRoots
      if (!tooBig && !tooOld && !rootsChanged) {
        const body = deltaBody(snapshot, upserts, removes)
        if (body === this.lastBody) return this.result('unchanged', snapshot, changes)
        const seq = this.seq + 1
        await writeFileAtomic(
          catalogDir,
          CATALOG_DELTA_FILE,
          `{"generation":${JSON.stringify(this.generation)},"seq":${seq},"updatedAt":${now},${body}}`
        )
        this.seq = seq
        this.lastBody = body
        return this.result('delta', snapshot, changes)
      }
    }
    const generation = this.newGeneration()
    await writeFileAtomic(
      catalogDir,
      CATALOG_FILE,
      fullCatalogText(snapshot, this.options.appVersion, now, generation)
    )
    // The state moves on only once the file is there; a failed write is simply retried.
    this.generation = generation
    this.base = new Map(snapshot.ids.map((id, i) => [id, snapshot.texts[i] as string]))
    this.baseAt = now
    this.baseRoots = JSON.stringify(snapshot.roots)
    this.seq = 0
    this.lastBody = deltaBody(snapshot, [], [])
    // The old delta belongs to the previous generation; panels would ignore it, but tidy up.
    await rm(nodePath.join(catalogDir, CATALOG_DELTA_FILE), { force: true }).catch(() => undefined)
    return this.result('full', snapshot, 0)
  }

  private diff(snapshot: CatalogSnapshot): { upserts: string[]; removes: string[] } {
    const upserts: string[] = []
    let known = 0
    for (let i = 0; i < snapshot.ids.length; i++) {
      const before = this.base.get(snapshot.ids[i] as string)
      if (before !== undefined) known++
      if (before !== snapshot.texts[i]) upserts.push(snapshot.texts[i] as string)
    }
    const removes: string[] = []
    if (known < this.base.size) {
      const current = new Set(snapshot.ids)
      for (const id of this.base.keys()) if (!current.has(id)) removes.push(id)
    }
    return { upserts, removes }
  }

  private result(
    kind: CatalogPublishResult['kind'],
    snapshot: CatalogSnapshot,
    changes: number
  ): CatalogPublishResult {
    return {
      kind,
      generation: this.generation as string,
      deltaSeq: this.seq,
      catalogUpdatedAt: this.baseAt,
      assets: snapshot.ids.length,
      changes
    }
  }
}

function deltaBody(snapshot: CatalogSnapshot, upserts: string[], removes: string[]): string {
  return (
    `"roots":${JSON.stringify(snapshot.roots)},"tags":${JSON.stringify(snapshot.tags)},` +
    `"upserts":[${upserts.join(',')}],"removes":${JSON.stringify(removes)}`
  )
}

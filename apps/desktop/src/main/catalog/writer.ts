import { mkdir, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LibraryRepository } from '../library/repository'

/** Version of the catalog format shared with the Premiere Pro panel. Bump on breaking changes. */
export const CATALOG_VERSION = 1

export interface CatalogAsset {
  id: string
  name: string
  kind: 'video' | 'audio' | 'image' | 'template'
  /** Absolute path of the original file: what gets imported into Premiere. */
  path: string
  folder: string
  root: string
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAlpha: boolean | null
  favorite: boolean
  tags: string[]
  addedAt: number
  /** Absolute paths of generated media in the cache, or null. */
  thumb: string | null
  sprite: string | null
  preview: string | null
  wave: string | null
}

export interface Catalog {
  version: number
  updatedAt: number
  app: string
  roots: { id: number; label: string; online: boolean }[]
  tags: string[]
  assets: CatalogAsset[]
}

/** Builds the catalog that the Premiere panel reads. Offline and missing assets are left out. */
export function buildCatalog(
  repo: LibraryRepository,
  mediaDir: string,
  appVersion: string
): Catalog {
  const roots = repo.listRoots()
  const rootLabel = new Map(roots.map((root) => [root.id, root.label]))
  const assets: CatalogAsset[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const page = repo.query({ sort: 'added', offset, limit: pageSize })
    for (const asset of page.items) {
      if (asset.status !== 'ok') continue
      const path = repo.assetPath(asset.id)
      if (!path) continue
      const files = repo.mediaFiles(asset.id)
      const media = (name: string | null | undefined): string | null =>
        name ? join(mediaDir, name) : null
      const slash = asset.relPath.lastIndexOf('/')
      assets.push({
        id: asset.id,
        name: asset.filename,
        kind: asset.kind,
        path,
        folder: slash === -1 ? '' : asset.relPath.slice(0, slash),
        root: rootLabel.get(asset.rootId) ?? '',
        durationMs: asset.durationMs,
        width: asset.width,
        height: asset.height,
        fps: asset.fps,
        hasAlpha: asset.hasAlpha,
        favorite: asset.favorite,
        tags: asset.tags,
        addedAt: asset.addedAt,
        thumb: media(files?.thumb),
        sprite: media(files?.sprite),
        preview: media(files?.preview),
        wave: media(files?.wave)
      })
    }
    if (offset + pageSize >= page.total) break
  }
  return {
    version: CATALOG_VERSION,
    updatedAt: Date.now(),
    app: appVersion,
    roots: roots.map((root) => ({ id: root.id, label: root.label, online: root.status === 'ok' })),
    tags: repo.listTags().map((tag) => tag.name),
    assets
  }
}

/** Writes catalog.json atomically (temp file + rename), so the panel never reads half a file. */
export async function writeCatalog(dir: string, catalog: Catalog): Promise<string> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, 'catalog.json')
  const temp = join(dir, `catalog.${process.pid}.tmp`)
  await writeFile(temp, JSON.stringify(catalog))
  await rename(temp, target)
  return target
}

import { join } from 'path'
import { writeFileAtomic } from './atomic-file'
import { safeJoin, type LibraryRepository } from '../library/repository'
import { CATALOG_VERSION, type Catalog, type CatalogAsset } from '@catalog/types'

export { CATALOG_VERSION } from '@catalog/types'

/** Builds the catalog that the Premiere panel reads. Offline and missing assets are left out. */
export function buildCatalog(
  repo: LibraryRepository,
  mediaDir: string,
  appVersion: string
): Catalog {
  const roots = repo.listRoots()
  const rootLabel = new Map(roots.map((root) => [root.id, root.label]))
  const media = (name: string | null): string | null => (name ? join(mediaDir, name) : null)
  const assets: CatalogAsset[] = []
  for (const row of repo.catalogRows()) {
    const path = safeJoin(row.rootPath, row.relPath)
    if (!path) continue
    const slash = row.relPath.lastIndexOf('/')
    assets.push({
      id: row.id,
      name: row.filename,
      kind: row.kind,
      path,
      folder: slash === -1 ? '' : row.relPath.slice(0, slash),
      root: rootLabel.get(row.rootId) ?? '',
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
    })
  }
  return {
    version: CATALOG_VERSION,
    updatedAt: Date.now(),
    app: appVersion,
    roots: roots.map((root) => ({
      id: root.id,
      label: root.label,
      online: root.status === 'ok',
      path: root.path
    })),
    tags: repo.listTags().map((tag) => tag.name),
    assets
  }
}

/** Writes catalog.json atomically (temp file + rename), so the panel never reads half a file. */
export async function writeCatalog(dir: string, catalog: Catalog): Promise<string> {
  return writeFileAtomic(dir, 'catalog.json', JSON.stringify(catalog))
}

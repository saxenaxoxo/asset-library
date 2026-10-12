import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
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
    roots: roots.map((root) => ({ id: root.id, label: root.label, online: root.status === 'ok' })),
    tags: repo.listTags().map((tag) => tag.name),
    assets
  }
}

let tempCounter = 0

/** On Windows a rename onto a file the panel is reading can briefly fail; retry a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

/** Writes catalog.json atomically (temp file + rename), so the panel never reads half a file. */
export async function writeCatalog(dir: string, catalog: Catalog): Promise<string> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, 'catalog.json')
  const temp = join(dir, `catalog.${process.pid}.${++tempCounter}.tmp`)
  try {
    await writeFile(temp, JSON.stringify(catalog))
    await renameWithRetry(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return target
}

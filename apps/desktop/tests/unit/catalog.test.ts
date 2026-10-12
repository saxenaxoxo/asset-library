import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { openDatabase } from '../../src/main/library/database'
import { migrate } from '../../src/main/library/migrations'
import { LibraryRepository } from '../../src/main/library/repository'
import { buildCatalog, CATALOG_VERSION, writeCatalog } from '../../src/main/catalog/writer'

// Native paths for whichever platform the tests run on.
const ROOT = resolve(sep, 'SSD', 'Assets')
const MEDIA = resolve(sep, 'media')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function library(): LibraryRepository {
  const db = openDatabase(':memory:')
  migrate(db)
  const repo = new LibraryRepository(db)
  const root = repo.addRoot(ROOT, 'Assets')
  const scanId = repo.startScan(root.id)
  repo.applyScanBatch(root.id, scanId, [
    { relPath: 'Overlays/Glow.mov', filename: 'Glow.mov', size: 10, mtimeMs: 1, fingerprint: 'a' },
    { relPath: 'SFX/Hit.wav', filename: 'Hit.wav', size: 10, mtimeMs: 1, fingerprint: 'b' }
  ])
  repo.finishScan(root.id, scanId)
  return repo
}

describe('catalog', () => {
  it('lists available assets with absolute original paths and generated media', () => {
    const repo = library()
    const glow = repo.query({ text: 'glow' }).items[0]!
    // The key must match the file's current content key ('a' is its fingerprint).
    repo.saveMedia(glow.id, 'a', {
      thumb: `${glow.id}-a.thumb.png`,
      sprite: null,
      preview: null,
      wave: null
    })
    repo.setFavorite(glow.id, true)

    const catalog = buildCatalog(repo, MEDIA, '0.1.0')
    expect(catalog.version).toBe(CATALOG_VERSION)
    expect(catalog.assets).toHaveLength(2)
    const entry = catalog.assets.find((a) => a.id === glow.id)!
    expect(entry).toMatchObject({
      name: 'Glow.mov',
      path: join(ROOT, 'Overlays', 'Glow.mov'),
      folder: 'Overlays',
      root: 'Assets',
      favorite: true,
      thumb: join(MEDIA, `${glow.id}-a.thumb.png`),
      preview: null
    })
  })

  it('leaves out assets on offline drives', () => {
    const repo = library()
    repo.setRootStatus(repo.listRoots()[0]!.id, 'offline')
    expect(buildCatalog(repo, MEDIA, '0.1.0').assets).toEqual([])
  })

  it('writes the file atomically with no temp files left behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'asset-library-catalog-'))
    dirs.push(dir)
    const path = await writeCatalog(dir, buildCatalog(library(), MEDIA, '0.1.0'))
    expect(JSON.parse(readFileSync(path, 'utf8')).assets).toHaveLength(2)
    expect(readdirSync(dir)).toEqual(['catalog.json'])
  })
})

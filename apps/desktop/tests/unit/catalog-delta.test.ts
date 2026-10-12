import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import nodePath, { join, resolve, sep } from 'path'
import {
  applyCatalogDelta,
  CATALOG_DELTA_FILE,
  parseCatalog,
  parseCatalogDelta,
  type Catalog,
  type CatalogDelta
} from '@catalog/types'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { migrate } from '../../src/main/library/migrations'
import { LibraryRepository, safeJoin } from '../../src/main/library/repository'
import {
  buildCatalog,
  CatalogPublisher,
  readCatalogSnapshot,
  rootJoiner,
  type CatalogLimits
} from '../../src/main/catalog/writer'

const ROOT = resolve(sep, 'SSD', 'Assets')
const MEDIA = resolve(sep, 'media')

let db: LibraryDatabase
let repo: LibraryRepository
let dir: string
let clock: number
let generations: number

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  clock = 1_000_000
  generations = 0
  repo = new LibraryRepository(db, () => clock++)
  dir = mkdtempSync(join(tmpdir(), 'asset-library-delta-'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Tiny test libraries would always cross the 15% rule, so it's off unless a test sets it. */
function publisher(limits: Partial<CatalogLimits> = { maxFraction: 100 }): CatalogPublisher {
  return new CatalogPublisher({
    catalogDir: dir,
    appVersion: '0.2.0',
    limits,
    now: () => clock,
    newGeneration: () => `gen-${++generations}`
  })
}

const publish = (p: CatalogPublisher, full = false): ReturnType<CatalogPublisher['publish']> =>
  p.publish(() => readCatalogSnapshot(repo, MEDIA), full)

/** Indexes files (relative paths) into a root in one complete scan. */
function scan(rootId: number, relPaths: string[]): void {
  const scanId = repo.startScan(rootId)
  repo.applyScanBatch(
    rootId,
    scanId,
    relPaths.map((relPath) => ({
      relPath,
      filename: relPath.split('/').pop()!,
      size: 10,
      mtimeMs: 1,
      fingerprint: relPath
    }))
  )
  repo.finishScan(rootId, scanId)
}

const idOf = (name: string): string => repo.query({ text: name }).items[0]!.id
const readCatalog = (): Catalog => parseCatalog(readFileSync(join(dir, 'catalog.json'), 'utf8'))
const readDelta = (): CatalogDelta | null =>
  existsSync(join(dir, CATALOG_DELTA_FILE))
    ? parseCatalogDelta(readFileSync(join(dir, CATALOG_DELTA_FILE), 'utf8'))
    : null

/** What the panel sees: catalog.json with the delta applied. */
function panelView(): Catalog {
  const base = readCatalog()
  const delta = readDelta()
  return delta ? applyCatalogDelta(base, delta) : base
}

function expectPanelSeesLibrary(): void {
  expect(panelView().assets).toEqual(buildCatalog(repo, MEDIA, '0.2.0').assets)
  expect(panelView().roots).toEqual(buildCatalog(repo, MEDIA, '0.2.0').roots)
  expect(panelView().tags).toEqual(buildCatalog(repo, MEDIA, '0.2.0').tags)
}

describe('rootJoiner', () => {
  it('gives exactly what safeJoin gives, on macOS and Windows paths', () => {
    const cases: [typeof nodePath, string[], string[]][] = [
      [
        nodePath.posix,
        ['/Volumes/SSD/Assets', '/Volumes/SSD/Assets/', '/'],
        [
          'a.wav',
          'Pack/SFX/Hit.wav',
          'Pack\\odd.wav',
          'Pack/../escape.wav',
          '../escape.wav',
          './a.wav',
          'Pack//a.wav',
          '/etc/passwd',
          'Pack/',
          'Pack/...wav',
          '.hidden/a.wav',
          ''
        ]
      ],
      [
        nodePath.win32,
        ['D:\\Assets', 'D:\\', '\\\\nas\\share\\Assets', 'C:\\Users\\me\\SFX\\'],
        [
          'a.wav',
          'Pack/SFX/Hit.wav',
          'Pack\\SFX\\Hit.wav',
          'Pack/../escape.wav',
          '..\\escape.wav',
          'C:/Windows/a.wav',
          'C:a.wav',
          'Pack//a.wav',
          '\\\\other\\share\\a.wav',
          ''
        ]
      ]
    ]
    for (const [path, roots, rels] of cases) {
      for (const root of roots) {
        const join = rootJoiner(root, path)
        for (const rel of rels)
          expect([root, rel, join(rel)]).toEqual([root, rel, safeJoin(root, rel, path)])
      }
    }
  })
})

describe('CatalogPublisher', () => {
  it('writes a full catalog first, then only the changes, which the panel can apply', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(root.id, ['SFX/Hit.wav', 'SFX/Whoosh.wav', 'Overlays/Glow.mov'])
    const p = publisher()
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-1', deltaSeq: 0 })
    expect(readCatalog()).toMatchObject({ generation: 'gen-1', app: '0.2.0' })
    expect(readCatalog().assets).toHaveLength(3)
    expect(readDelta()).toBeNull()
    const fullWrittenAt = readCatalog().updatedAt

    // A favorite and a tag: one changed asset, written as a delta. catalog.json stays as it was.
    repo.setFavorite(idOf('Hit'), true)
    repo.addTag(idOf('Whoosh'), 'transitions')
    clock += 1000
    expect(await publish(p)).toMatchObject({
      kind: 'delta',
      generation: 'gen-1',
      deltaSeq: 1,
      changes: 2,
      catalogUpdatedAt: fullWrittenAt
    })
    expect(readCatalog().updatedAt).toBe(fullWrittenAt)
    expect(readDelta()).toMatchObject({ generation: 'gen-1', seq: 1, removes: [] })
    expect(
      readDelta()!
        .upserts.map((a) => a.name)
        .sort()
    ).toEqual(['Hit.wav', 'Whoosh.wav'])
    expectPanelSeesLibrary()

    // New files and a deleted one: still a delta, cumulative since the full catalog.
    scan(root.id, ['SFX/Hit.wav', 'SFX/Whoosh.wav', 'SFX/Boom.wav', 'SFX/Rise.wav'])
    expect(await publish(p)).toMatchObject({ kind: 'delta', deltaSeq: 2, changes: 5 })
    const delta = readDelta()!
    expect(delta.removes).toHaveLength(1)
    expect(delta.upserts.map((a) => a.name)).toContain('Hit.wav')
    expectPanelSeesLibrary()
    expect(readdirSync(dir).sort()).toEqual(['catalog-delta.json', 'catalog.json'])
  })

  it('writes nothing when nothing changed, and a new delta when a change is undone', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(root.id, ['SFX/Hit.wav'])
    const p = publisher()
    await publish(p)
    expect(await publish(p)).toMatchObject({ kind: 'unchanged', deltaSeq: 0 })
    expect(readDelta()).toBeNull()
    repo.setFavorite(idOf('Hit'), true)
    expect(await publish(p)).toMatchObject({ kind: 'delta', deltaSeq: 1 })
    expect(await publish(p)).toMatchObject({ kind: 'unchanged', deltaSeq: 1 })
    repo.setFavorite(idOf('Hit'), false)
    expect(await publish(p)).toMatchObject({ kind: 'delta', deltaSeq: 2, changes: 0 })
    expect(readDelta()!.upserts).toEqual([])
    expectPanelSeesLibrary()
  })

  it('writes a full catalog when a folder is added, removed or goes offline', async () => {
    const a = repo.addRoot(ROOT, 'Assets')
    scan(a.id, ['SFX/Hit.wav'])
    const p = publisher()
    await publish(p)
    // Older panels read only catalog.json, so folder changes go there straight away.
    const b = repo.addRoot(resolve(sep, 'SSD', 'Music'), 'Music')
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-2' })
    expect(readCatalog().roots.map((r) => r.id)).toEqual([a.id, b.id])
    repo.setRootStatus(a.id, 'offline')
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-3' })
    expect(readCatalog().roots.find((r) => r.id === a.id)?.online).toBe(false)
    expect(readCatalog().assets).toEqual([])
    expectPanelSeesLibrary()
  })

  it('writes a new full catalog when the changes get large', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(
      root.id,
      Array.from({ length: 100 }, (_, i) => `SFX/Hit ${i}.wav`)
    )
    const p = publisher({ maxChanges: 5, maxFraction: 1 })
    await publish(p)
    for (const item of repo.query({ limit: 5 }).items) repo.setFavorite(item.id, true)
    expect(await publish(p)).toMatchObject({ kind: 'delta', changes: 5 })
    expect(readDelta()).not.toBeNull()
    repo.setFavorite(repo.query({ limit: 6 }).items[5]!.id, true)
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-2', deltaSeq: 0 })
    // The old generation's delta is gone, and the new catalog is complete on its own.
    expect(readDelta()).toBeNull()
    expect(readCatalog().generation).toBe('gen-2')
    expectPanelSeesLibrary()
  })

  it('writes a new full catalog when more than 15% of the library changed', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(
      root.id,
      Array.from({ length: 20 }, (_, i) => `SFX/Hit ${i}.wav`)
    )
    const p = publisher({ maxFraction: 0.15 })
    await publish(p)
    const items = repo.query({ limit: 4 }).items
    for (const item of items.slice(0, 3)) repo.setFavorite(item.id, true)
    expect(await publish(p)).toMatchObject({ kind: 'delta', changes: 3 })
    repo.setFavorite(items[3]!.id, true)
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-2' })
  })

  it('folds an old delta into a full catalog, so older panels catch up', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(root.id, ['SFX/Hit.wav', 'SFX/Boom.wav', 'SFX/Rise.wav', 'SFX/Fall.wav', 'SFX/Zap.wav'])
    const p = publisher({ maxAgeMs: 60_000, maxFraction: 1 })
    await publish(p)
    clock += 59_000
    expect(await publish(p)).toMatchObject({ kind: 'unchanged' }) // nothing to fold
    repo.setFavorite(idOf('Hit'), true)
    expect(await publish(p)).toMatchObject({ kind: 'delta' })
    clock += 1000
    expect(await publish(p)).toMatchObject({ kind: 'full', generation: 'gen-2' })
    expect(readCatalog().assets.find((a) => a.name === 'Hit.wav')?.favorite).toBe(true)
  })

  it('always writes a full catalog when asked (start-up)', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(root.id, ['SFX/Hit.wav'])
    const p = publisher()
    await publish(p)
    expect(await publish(p, true)).toMatchObject({ kind: 'full', generation: 'gen-2' })
  })

  it('the full catalog is the same as the one older engines wrote, plus its generation', async () => {
    const root = repo.addRoot(ROOT, 'Assets')
    scan(root.id, ['SFX/Hit.wav', 'Overlays/Glow.mov'])
    repo.saveMedia(idOf('Glow'), 'Overlays/G', {
      thumb: 'glow.thumb.jpg',
      sprite: null,
      preview: null,
      wave: null
    })
    await publish(publisher())
    const { generation, updatedAt, ...rest } = readCatalog()
    expect(generation).toBe('gen-1')
    expect(updatedAt).toBe(clock)
    const fresh = buildCatalog(repo, MEDIA, '0.2.0')
    expect({ ...rest, updatedAt: 0 }).toEqual({ ...fresh, updatedAt: 0 })
    expect(rest.assets.find((a) => a.name === 'Glow.mov')?.thumb).toBe(
      join(MEDIA, 'glow.thumb.jpg')
    )
  })
})

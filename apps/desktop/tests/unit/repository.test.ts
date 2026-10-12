import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { migrate, SCHEMA_VERSION } from '../../src/main/library/migrations'
import { ftsQuery, LibraryRepository, safeJoin } from '../../src/main/library/repository'
import type { ScanEntry } from '../../src/main/library/types'

let db: LibraryDatabase
let clock: number
let repo: LibraryRepository

function entry(relPath: string, fingerprint: string, size = 1000, mtimeMs = 1): ScanEntry {
  const filename = relPath.split('/').pop() as string
  return { relPath, filename, size, mtimeMs, fingerprint }
}

/** Runs one complete scan of a root with the given files. */
function scan(rootId: number, entries: ScanEntry[]): ReturnType<LibraryRepository['finishScan']> {
  clock += 1000
  const scanId = repo.startScan(rootId)
  repo.applyScanBatch(rootId, scanId, entries)
  return repo.finishScan(rootId, scanId)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  clock = 1_700_000_000_000
  repo = new LibraryRepository(db, () => clock)
})

afterEach(() => db.close())

describe('migrations', () => {
  it('creates the schema and records its version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('is a no-op when run twice', () => {
    expect(migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
  })

  it('refuses a database from a newer app version', () => {
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(db)).toThrow(/newer version/)
  })
})

describe('roots', () => {
  it('adds a root once, even if added twice', () => {
    const a = repo.addRoot('/Volumes/SSD/Assets', 'Assets')
    const b = repo.addRoot('/Volumes/SSD/Assets', 'Assets')
    expect(a.id).toBe(b.id)
    expect(repo.listRoots()).toHaveLength(1)
  })

  it('removing a root forgets its assets', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1')])
    repo.removeRoot(root.id)
    expect(repo.query({}).total).toBe(0)
  })
})

describe('scanning', () => {
  it('indexes supported files and ignores others', () => {
    const root = repo.addRoot('/r', 'r')
    const summary = scan(root.id, [
      entry('Overlays/light leak.mov', 'f1'),
      entry('SFX/whoosh.wav', 'f2'),
      entry('notes.txt', 'f3')
    ])
    expect(summary.added).toBe(2)
    const kinds = repo.query({ sort: 'name' }).items.map((a) => a.kind)
    expect(kinds.sort()).toEqual(['audio', 'video'])
  })

  it('keeps ID, favorite and tags when a file moves within the root', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('old/flare.mov', 'same-content')])
    const before = repo.query({}).items[0]!
    repo.setFavorite(before.id, true)
    repo.addTag(before.id, 'flares')

    const summary = scan(root.id, [entry('new/flare-renamed.mov', 'same-content')])

    expect(summary).toMatchObject({ moved: 1, added: 0, missing: 0 })
    const after = repo.query({}).items
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({
      id: before.id,
      relPath: 'new/flare-renamed.mov',
      favorite: true,
      tags: ['flares']
    })
  })

  it('marks files missing after a complete scan, and restores them when they return', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1'), entry('b.mp4', 'f2')])
    const b = repo.query({ text: 'b.mp4' }).items[0]!
    repo.setFavorite(b.id, true)

    expect(scan(root.id, [entry('a.mp4', 'f1')]).missing).toBe(1)
    expect(repo.query({}).total).toBe(1)
    expect(repo.query({ missingOnly: true }).items[0]?.id).toBe(b.id)

    scan(root.id, [entry('a.mp4', 'f1'), entry('b.mp4', 'f2')])
    const restored = repo.getAsset(b.id)!
    expect(restored.status).toBe('ok')
    expect(restored.favorite).toBe(true)
  })

  it('never marks files missing from an aborted scan (drive unplugged mid-scan)', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1'), entry('b.mp4', 'f2')])
    const scanId = repo.startScan(root.id)
    repo.applyScanBatch(root.id, scanId, [entry('a.mp4', 'f1')])
    repo.abortScan(scanId)
    expect(repo.query({ missingOnly: true }).total).toBe(0)
  })

  it('recovers scans interrupted by a crash without losing data', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1')])
    repo.startScan(root.id) // app "crashes" here
    expect(repo.recoverInterruptedScans()).toBe(1)
    expect(repo.getRoot(root.id)?.scanning).toBe(false)
    expect(repo.query({}).total).toBe(1)
  })

  it('shows assets on an offline drive as offline, not missing', () => {
    const root = repo.addRoot('/Volumes/Unplugged', 'Unplugged')
    scan(root.id, [entry('a.mp4', 'f1')])
    repo.setRootStatus(root.id, 'offline')
    const asset = repo.query({}).items[0]!
    expect(asset.status).toBe('offline')
    expect(repo.query({ missingOnly: true }).total).toBe(0)
  })

  it('re-probes a file whose size or date changed', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1', 1000, 1)])
    const id = repo.query({}).items[0]!.id
    repo.saveProbe(id, {
      width: 1920,
      height: 1080,
      durationMs: 5000,
      fps: 25,
      codec: 'h264',
      hasAlpha: false,
      channels: 2,
      sampleRate: 48000
    })
    expect(repo.getAsset(id)?.probeState).toBe('done')
    scan(root.id, [entry('a.mp4', 'f1-changed', 2000, 2)])
    expect(repo.getAsset(id)?.probeState).toBe('pending')
  })

  it('records unreadable files as errors instead of failing the scan', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [
      {
        relPath: 'locked.mov',
        filename: 'locked.mov',
        size: 0,
        mtimeMs: 0,
        fingerprint: null,
        error: 'EACCES'
      }
    ])
    expect(repo.query({}).items[0]).toMatchObject({ status: 'error', errorMessage: 'EACCES' })
  })
})

describe('queries', () => {
  beforeEach(() => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [
      entry('Transitions/Glitch Transition 01.mov', 'g1'),
      entry('Transitions/Whip Pan.mov', 'w1'),
      entry('SFX/Whoosh Big.wav', 's1'),
      entry('Textures/Paper.png', 'p1')
    ])
  })

  it('finds assets by any part of the name or folder', () => {
    expect(repo.query({ text: 'glitch' }).items.map((a) => a.filename)).toEqual([
      'Glitch Transition 01.mov'
    ])
    expect(repo.query({ text: 'transitions' }).total).toBe(2)
    expect(repo.query({ text: 'whoosh big' }).total).toBe(1)
  })

  it('falls back to a substring match for very short searches', () => {
    expect(repo.query({ text: 'wh' }).total).toBe(2)
  })

  it('finds assets by tag', () => {
    const paper = repo.query({ text: 'paper' }).items[0]!
    repo.addTag(paper.id, 'grunge')
    expect(repo.query({ text: 'grunge' }).items[0]?.id).toBe(paper.id)
    expect(repo.query({ tag: 'grunge' }).total).toBe(1)
    repo.removeTag(paper.id, 'grunge')
    expect(repo.query({ tag: 'grunge' }).total).toBe(0)
    expect(repo.listTags()).toEqual([])
  })

  it('filters by kind and favorites, and pages results', () => {
    expect(repo.query({ kind: 'video' }).total).toBe(2)
    expect(repo.query({ kind: 'image' }).total).toBe(1)
    const page = repo.query({ sort: 'name', limit: 2, offset: 2 })
    expect(page.total).toBe(4)
    expect(page.items).toHaveLength(2)
    const whip = repo.query({ text: 'whip' }).items[0]!
    repo.setFavorite(whip.id, true)
    expect(repo.query({ favoritesOnly: true }).items.map((a) => a.id)).toEqual([whip.id])
    expect(repo.counts()).toMatchObject({ total: 4, video: 2, audio: 1, image: 1, favorites: 1 })
  })

  it('treats search text as literal, not query syntax', () => {
    expect(() => repo.query({ text: '"; drop table assets; --' })).not.toThrow()
    expect(repo.query({ text: 'NEAR OR AND *' }).total).toBe(0)
  })
})

describe('paths', () => {
  it('keeps resolved paths inside the root', () => {
    expect(safeJoin('/Volumes/SSD/Assets', 'SFX/whoosh.wav')).toBe(
      '/Volumes/SSD/Assets/SFX/whoosh.wav'
    )
    expect(safeJoin('/Volumes/SSD/Assets', '../../etc/passwd')).toBeNull()
    expect(safeJoin('/Volumes/SSD/Assets', '/etc/passwd')).toBeNull()
    expect(safeJoin('/Volumes/SSD/Assets', '')).toBeNull()
  })

  it('quotes every search word for FTS', () => {
    expect(ftsQuery('glitch "pan"')).toBe('"glitch" AND """pan"""')
    expect(ftsQuery('a b')).toBeNull()
  })
})

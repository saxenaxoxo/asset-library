import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../../src/main/library/migrations'
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

  it('keeps search working for libraries created before the search-id upgrade', () => {
    const old = openDatabase(':memory:')
    old.exec(MIGRATIONS[0] as string)
    old.exec(MIGRATIONS[1] as string)
    old.pragma('user_version = 2')
    old.prepare(`insert into roots (id, path, label, added_at) values (1, '/r', 'r', 0)`).run()
    old
      .prepare(
        `insert into assets (id, root_id, rel_path, filename, ext, kind, size, mtime, added_at,
           indexed_at, last_seen_scan) values ('a', 1, 'FX/glow.mov', 'glow.mov', 'mov', 'video', 1, 1, 0, 0, 0)`
      )
      .run()
    old
      .prepare(
        `insert into assets_fts (asset_id, filename, rel_path, tags) values ('a', 'glow.mov', 'FX/glow.mov', '')`
      )
      .run()
    migrate(old)
    const upgraded = new LibraryRepository(old)
    expect(upgraded.query({ text: 'glow' }).items.map((a) => a.id)).toEqual(['a'])
    upgraded.addTag('a', 'sparkle')
    expect(upgraded.query({ text: 'sparkle' }).total).toBe(1)
    expect(upgraded.query({ text: 'glow' }).total).toBe(1)
    old.close()
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
    repo.saveProbe(id, 'f1', {
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

  it('drops a probe result for a file that changed while it was being probed', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'f1', 1000, 1)])
    const [job] = repo.pendingProbes(10)
    scan(root.id, [entry('a.mp4', 'f2', 2000, 2)]) // rescan sees the new version
    repo.saveProbe(job!.id, job!.fingerprint, {
      width: 1,
      height: 1,
      durationMs: 1,
      fps: 1,
      codec: 'old',
      hasAlpha: false,
      channels: null,
      sampleRate: null
    })
    expect(repo.getAsset(job!.id)?.probeState).toBe('pending')
    expect(repo.pendingProbes(10)[0]?.fingerprint).toBe('f2')
  })

  it('drops generated media for a file that changed while it was being generated', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('a.mp4', 'aaaaaaaaaaaa-1', 1000, 1)])
    const id = repo.query({}).items[0]!.id
    db.prepare(`update assets set probe_state = 'done' where id = ?`).run(id)
    const [job] = repo.pendingMedia(10)
    scan(root.id, [entry('a.mp4', 'bbbbbbbbbbbb-2', 2000, 2)])
    db.prepare(`update assets set probe_state = 'done' where id = ?`).run(id)
    repo.saveMedia(id, job!.key, { thumb: 'old.jpg', sprite: null, preview: null, wave: null })
    expect(repo.getAsset(id)?.media.thumb).toBe(false)
    const [next] = repo.pendingMedia(10)
    repo.saveMedia(id, next!.key, { thumb: 'new.jpg', sprite: null, preview: null, wave: null })
    expect(repo.mediaFiles(id)?.thumb).toBe('new.jpg')
  })

  it('keeps tags added to a moved file while the scan was still running', () => {
    const root = repo.addRoot('/r', 'r')
    scan(root.id, [entry('old/a.mp4', 'fp')])
    const original = repo.query({}).items[0]!.id
    clock += 1000
    const scanId = repo.startScan(root.id)
    repo.applyScanBatch(root.id, scanId, [entry('new/a.mp4', 'fp')])
    const copy = repo.query({}).items.find((a) => a.relPath === 'new/a.mp4')!.id
    repo.addTag(copy, 'tagged-mid-scan')
    repo.finishScan(root.id, scanId)
    const assets = repo.query({}).items
    expect(assets).toHaveLength(1)
    expect(assets[0]?.id).toBe(original)
    expect(assets[0]?.tags).toContain('tagged-mid-scan')
    expect(repo.query({ text: 'new/a' }).total).toBe(1)
  })

  it('keeps only the latest scan record per root', () => {
    const root = repo.addRoot('/r', 'r')
    for (let i = 0; i < 5; i++) scan(root.id, [entry('a.mp4', 'f1')])
    expect(db.prepare('select count(*) as n from scans').get()).toEqual({ n: 1 })
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

  it('uses short words to narrow a longer search', () => {
    // "01" is too short for the search index; it must still narrow the results.
    expect(repo.query({ text: 'transition 01' }).items.map((a) => a.filename)).toEqual([
      'Glitch Transition 01.mov'
    ])
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

  it('never repeats or skips assets across pages when sort keys tie', () => {
    const root = repo.addRoot('/r', 'r')
    scan(
      root.id,
      Array.from({ length: 30 }, (_, i) => entry(`folder ${i}/preview.mp4`, `f${i}`))
    )
    const seen = new Set<string>()
    for (let offset = 0; offset < 30; offset += 7) {
      for (const asset of repo.query({ offset, limit: 7 }).items) seen.add(asset.id)
    }
    expect(seen.size).toBe(30)
  })

  it('lists catalog rows for available assets only', () => {
    const online = repo.addRoot('/on', 'on')
    const offline = repo.addRoot('/off', 'off')
    scan(online.id, [entry('a.mp4', 'f1'), entry('gone.mp4', 'f2')])
    scan(online.id, [entry('a.mp4', 'f1')]) // gone.mp4 is now missing
    scan(offline.id, [entry('b.mp4', 'f3')])
    repo.setRootStatus(offline.id, 'offline')
    const rows = repo
      .catalogRows()
      .filter((row) => row.rootId === online.id || row.rootId === offline.id)
    expect(rows.map((row) => row.relPath)).toEqual(['a.mp4'])
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

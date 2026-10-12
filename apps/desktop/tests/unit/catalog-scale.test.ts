import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { migrate } from '../../src/main/library/migrations'
import { LibraryRepository } from '../../src/main/library/repository'
import { CatalogPublisher, readCatalogSnapshot } from '../../src/main/catalog/writer'

// A 100,000-asset library: how long the engine needs to build the catalog, tell what changed
// and write it. The numbers are printed; the limits are loose so slower CI machines pass too.
const ASSETS = 100_000
const MEDIA = resolve(
  sep,
  'Users',
  'editor',
  'Library',
  'Application Support',
  'Asset Library',
  'media'
)

let db: LibraryDatabase
let repo: LibraryRepository
let dir: string

beforeAll(() => {
  db = openDatabase(':memory:')
  migrate(db)
  repo = new LibraryRepository(db)
  const root = repo.addRoot(resolve(sep, 'Volumes', 'SSD', 'Assets Library'), 'Assets Library')
  db.prepare(`insert into scans (id, root_id, started_at, state) values (1, ?, 0, 'done')`).run(
    root.id
  )
  // Realistic rows (names, nested folders, durations, generated media), inserted directly.
  db.prepare(
    `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
     insert into assets (id, root_id, rel_path, filename, ext, kind, size, mtime, fingerprint,
       width, height, duration_ms, fps, probe_state, media_state, media_key, thumb_file,
       wave_file, added_at, indexed_at, last_seen_scan, search_id)
     select printf('%08x-0000-4000-8000-%012x', i, i), ?,
       printf('Sound Pack %d/Category %d/Whoosh Long Transition %d.wav', i % 300, i % 7, i),
       printf('Whoosh Long Transition %d.wav', i), 'wav', 'audio', 1000 + i, 1, printf('fp%d', i),
       null, null, 1500 + i % 9000, null, 'done', 'done', printf('fp%d', i),
       printf('%08x-fp%d.thumb.jpg', i, i), printf('%08x-fp%d.wave.png', i, i), i, i, 1, i
     from n`
  ).run(ASSETS, root.id)
  db.exec(`insert into tags (name) values ('whoosh'), ('transitions')`)
  db.exec(`insert into asset_tags (asset_id, tag_id) select id, 1 from assets where rowid % 10 = 0`)
  dir = mkdtempSync(join(tmpdir(), 'asset-library-scale-'))
}, 60_000)

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const time = async <T>(work: () => T | Promise<T>): Promise<[T, number]> => {
  const start = performance.now()
  const value = await work()
  return [value, Math.round(performance.now() - start)]
}

describe('catalog at 100k assets', () => {
  it('builds, diffs and writes quickly, and a small change is a small file', async () => {
    const publisher = new CatalogPublisher({ catalogDir: dir, appVersion: '0.2.0' })
    const read = (): ReturnType<typeof readCatalogSnapshot> => readCatalogSnapshot(repo, MEDIA)

    const [snapshot, readMs] = await time(read)
    expect(snapshot.ids).toHaveLength(ASSETS)
    const [full, fullMs] = await time(() => publisher.publish(read))
    expect(full.kind).toBe('full')
    const fullBytes = statSync(join(dir, 'catalog.json')).size

    // The editor favorites 100 assets: one delta with just those.
    const ids = snapshot.ids.slice(0, 100)
    const favorite = db.prepare('update assets set favorite = 1 where id = ?')
    for (const id of ids) favorite.run(id)
    const [delta, deltaMs] = await time(() => publisher.publish(read))
    expect(delta).toMatchObject({ kind: 'delta', changes: 100 })
    const deltaBytes = statSync(join(dir, 'catalog-delta.json')).size
    const [, unchangedMs] = await time(() => publisher.publish(read))

    console.log(
      `catalog at ${ASSETS.toLocaleString('en-US')} assets: read+serialize ${readMs} ms, ` +
        `full publish ${fullMs} ms (${(fullBytes / 1e6).toFixed(1)} MB), ` +
        `delta publish (read+diff+write) ${deltaMs} ms (${(deltaBytes / 1e3).toFixed(1)} KB), ` +
        `unchanged check ${unchangedMs} ms`
    )
    expect(deltaBytes).toBeLessThan(200_000)
    // About 0.5 s on a recent Mac; the limit leaves room for slower CI machines.
    expect(deltaMs).toBeLessThan(3000)
  }, 60_000)
})

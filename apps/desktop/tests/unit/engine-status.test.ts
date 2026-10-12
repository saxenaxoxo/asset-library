import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseEngineStatus, type RequestResult } from '@catalog/requests'
import { EngineStatusWriter, MAX_RESULTS, statusLine } from '../../src/main/engine/status'

let dir: string
let mediaDir: string
let clock: number
let indexing: { rootIds: number[]; filesSeen: number }
let writer: EngineStatusWriter

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'asset-library-status-'))
  mediaDir = join(dir, 'media')
  mkdirSync(mediaDir)
  writeFileSync(join(mediaDir, 'a.jpg'), 'x'.repeat(100))
  writeFileSync(join(mediaDir, 'b.mp4'), 'x'.repeat(50))
  clock = 1_000_000
  indexing = { rootIds: [3], filesSeen: 120 }
  writer = new EngineStatusWriter(
    join(dir, 'catalog'),
    {
      version: '0.2.0',
      importsFolder: '/Users/me/Movies/Asset Library Imports',
      mediaDir,
      indexing: () => indexing,
      pendingMedia: () => 7,
      startAtLogin: () => true
    },
    3000,
    () => clock
  )
})

afterEach(async () => {
  // A write scheduled by the test may still be in flight; let it finish before the folder goes.
  await writer.shutdown()
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

const read = (): ReturnType<typeof parseEngineStatus> =>
  parseEngineStatus(readFileSync(join(dir, 'catalog', 'engine.json'), 'utf8'))

const result = (n: number): RequestResult => ({ id: `r${n}`, ok: true, message: `m${n}`, at: n })

describe('EngineStatusWriter', () => {
  it('writes everything the panel reads, atomically', async () => {
    await writer.write()
    expect(read()).toEqual({
      version: '0.2.0',
      updatedAt: 1_000_000,
      indexing: { rootIds: [3], filesSeen: 120 },
      pendingMedia: 7,
      settings: { startAtLogin: true },
      cacheBytes: 150,
      importsFolder: '/Users/me/Movies/Asset Library Imports',
      results: []
    })
    // No temp files left behind.
    expect(readdirSync(join(dir, 'catalog'))).toEqual(['engine.json'])
  })

  it('keeps the newest 20 results, newest last', async () => {
    for (let n = 1; n <= 25; n++) writer.record(result(n))
    await writer.write()
    const results = read()!.results
    expect(results).toHaveLength(MAX_RESULTS)
    expect(results[0]?.id).toBe('r6')
    expect(results.at(-1)?.id).toBe('r25')
  })

  it('measures the cache at most once a minute, unless told it changed', async () => {
    await writer.write()
    writeFileSync(join(mediaDir, 'c.jpg'), 'x'.repeat(1000))
    clock += 30_000
    await writer.write()
    expect(read()!.cacheBytes).toBe(150)
    writer.invalidateCacheSize()
    await writer.write()
    expect(read()!.cacheBytes).toBe(1150)
    rmSync(join(mediaDir, 'c.jpg'))
    clock += 60_000
    await writer.write()
    expect(read()!.cacheBytes).toBe(150)
  })

  it('tells listeners and stops writing after stop()', async () => {
    const seen: number[] = []
    writer.onStatus((status) => seen.push(status.updatedAt))
    await writer.write()
    writer.stop()
    clock += 5000
    await writer.write()
    expect(seen).toEqual([1_000_000])
    expect(read()!.updatedAt).toBe(1_000_000)
  })

  it('survives a source that throws (database closing)', async () => {
    const broken = new EngineStatusWriter(join(dir, 'catalog'), {
      version: '0',
      importsFolder: '',
      mediaDir,
      indexing: () => {
        throw new Error('The database connection is not open')
      },
      pendingMedia: () => 0,
      startAtLogin: () => false
    })
    await expect(broken.write()).resolves.toBeUndefined()
  })
})

describe('EngineStatusWriter catalog, update and quitting', () => {
  it('publishes the catalog version, the update setting and a newer release', async () => {
    const full = new EngineStatusWriter(
      join(dir, 'catalog'),
      {
        version: '0.2.0',
        importsFolder: '',
        mediaDir,
        indexing: () => ({ rootIds: [], filesSeen: 0 }),
        pendingMedia: () => 0,
        startAtLogin: () => false,
        catalogUpdatedAt: () => 123,
        catalog: () => ({ generation: 'g1', deltaSeq: 4 }),
        checkForUpdates: () => true,
        update: () => ({
          version: '0.3.0',
          url: 'https://github.com/saxenaxoxo/asset-library/releases/tag/v0.3.0'
        })
      },
      3000,
      () => clock
    )
    await full.write()
    expect(read()).toMatchObject({
      catalogUpdatedAt: 123,
      catalog: { generation: 'g1', deltaSeq: 4 },
      settings: { startAtLogin: false, checkForUpdates: true },
      update: {
        version: '0.3.0',
        url: 'https://github.com/saxenaxoxo/asset-library/releases/tag/v0.3.0'
      }
    })
    full.stop()
  })

  it('removes engine.json on quit, so the panel knows at once', async () => {
    await writer.write()
    expect(existsSync(writer.file)).toBe(true)
    await writer.shutdown()
    expect(existsSync(writer.file)).toBe(false)
    // Nothing writes it again afterwards.
    await writer.write()
    expect(existsSync(writer.file)).toBe(false)
  })

  it('a write already under way when quitting does not bring the file back', async () => {
    const slow = new EngineStatusWriter(
      join(dir, 'catalog'),
      {
        version: '0',
        importsFolder: '',
        mediaDir,
        indexing: () => ({ rootIds: [], filesSeen: 0 }),
        pendingMedia: () => 0,
        startAtLogin: () => true
      },
      3000,
      () => clock
    )
    await slow.write()
    clock += 60_000 // the next write measures the cache folder again, so it takes a moment
    const writing = slow.write()
    const quitting = slow.shutdown()
    await Promise.all([writing, quitting])
    expect(existsSync(slow.file)).toBe(false)
  })
})

describe('statusLine', () => {
  it('says what the engine is doing', () => {
    expect(statusLine({ indexing: { rootIds: [1], filesSeen: 1200 }, pendingMedia: 5 })).toBe(
      'Indexing 1,200 files…'
    )
    expect(statusLine({ indexing: { rootIds: [1], filesSeen: 0 }, pendingMedia: 0 })).toBe(
      'Indexing…'
    )
    expect(statusLine({ indexing: { rootIds: [], filesSeen: 0 }, pendingMedia: 12 })).toBe(
      'Making previews (12 left)'
    )
    expect(statusLine({ indexing: { rootIds: [], filesSeen: 0 }, pendingMedia: 0 })).toBe(
      'Up to date'
    )
  })
})

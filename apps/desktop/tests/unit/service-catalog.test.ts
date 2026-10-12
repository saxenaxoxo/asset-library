import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogPublishResult } from '../../src/main/catalog/writer'

vi.mock('electron', () => ({ utilityProcess: {} }))
const { openDatabase } = await import('../../src/main/library/database')
const { migrate } = await import('../../src/main/library/migrations')
const { LibraryRepository } = await import('../../src/main/library/repository')
const { LibraryService } = await import('../../src/main/library/service')
const { WorkerError } = await import('../../src/main/worker/client')
const { workerCatalogPublishing } = await import('../../src/main/catalog/publishing')
const { CATALOG_LIMITS } = await import('../../src/main/catalog/writer')

const result = (over: Partial<CatalogPublishResult> = {}): CatalogPublishResult => ({
  kind: 'full',
  generation: 'g1',
  deltaSeq: 0,
  catalogUpdatedAt: Date.now(),
  assets: 0,
  changes: 0,
  ...over
})

let db: ReturnType<typeof openDatabase>
let repo: InstanceType<typeof LibraryRepository>

beforeEach(() => {
  vi.useFakeTimers()
  db = openDatabase(':memory:')
  migrate(db)
  repo = new LibraryRepository(db)
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
})

function service(
  publish: (full: boolean) => Promise<CatalogPublishResult>,
  onCatalog = vi.fn()
): InstanceType<typeof LibraryService> {
  const worker = { request: vi.fn(() => new Promise(() => undefined)), stop: vi.fn() }
  return new LibraryService(
    repo,
    worker as never,
    { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    { mediaDir: '/nonexistent/media', catalogDir: '/nonexistent/catalog', appVersion: '0' },
    () => undefined,
    { publishCatalog: publish, onCatalog }
  )
}

describe('LibraryService catalog writes', () => {
  it('writes a full catalog at start-up, then deltas, and reports each write', async () => {
    const publish = vi
      .fn<(full: boolean) => Promise<CatalogPublishResult>>()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ kind: 'delta', deltaSeq: 1 }))
    const onCatalog = vi.fn()
    const library = service(publish, onCatalog)
    expect(library.catalogVersion()).toBeNull()
    library.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(publish).toHaveBeenCalledExactlyOnceWith(true)
    expect(onCatalog).toHaveBeenCalledTimes(1)
    expect(library.catalogVersion()).toEqual({ generation: 'g1', deltaSeq: 0 })

    // A favorite set by hand goes out within a moment, as a delta.
    library.organizingChanged()
    await vi.advanceTimersByTimeAsync(400)
    expect(publish).toHaveBeenLastCalledWith(false)
    expect(library.catalogVersion()).toEqual({ generation: 'g1', deltaSeq: 1 })
    library.stop()
  })

  it('retries a failed first write as a full catalog', async () => {
    const publish = vi
      .fn<(full: boolean) => Promise<CatalogPublishResult>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(result())
    const library = service(publish)
    library.start()
    await vi.advanceTimersByTimeAsync(2000)
    library.organizingChanged()
    await vi.advanceTimersByTimeAsync(400)
    expect(publish.mock.calls).toEqual([[true], [true]])
    expect(library.catalogVersion()).not.toBeNull()
    library.stop()
  })

  it('comes back to fold a lingering delta into catalog.json for older panels', async () => {
    const now = Date.now()
    const publish = vi
      .fn<(full: boolean) => Promise<CatalogPublishResult>>()
      .mockResolvedValueOnce(result({ catalogUpdatedAt: now }))
      .mockResolvedValueOnce(result({ kind: 'delta', deltaSeq: 1, catalogUpdatedAt: now }))
      .mockResolvedValue(result({ generation: 'g2', catalogUpdatedAt: now }))
    const library = service(publish)
    library.start()
    await vi.advanceTimersByTimeAsync(2000)
    library.organizingChanged()
    await vi.advanceTimersByTimeAsync(400)
    expect(publish).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CATALOG_LIMITS.maxAgeMs + 5000)
    expect(publish).toHaveBeenCalledTimes(3)
    expect(library.catalogVersion()).toEqual({ generation: 'g2', deltaSeq: 0 })
    // No delta left: no more wake-ups.
    await vi.advanceTimersByTimeAsync(CATALOG_LIMITS.maxAgeMs * 2)
    expect(publish).toHaveBeenCalledTimes(3)
    library.stop()
  })

  it('stops counting a folder as indexing even when its scan fails to start', async () => {
    const library = service(async () => result())
    const root = repo.addRoot('/r', 'r')
    vi.spyOn(repo, 'startScan').mockImplementation(() => {
      throw new Error('database is locked')
    })
    await library.rescan(root.id)
    expect(library.indexing()).toEqual({ rootIds: [], filesSeen: 0 })
    library.stop()
  })
})

describe('workerCatalogPublishing', () => {
  const request = { dbFile: '/db', catalogDir: '/c', mediaDir: '/m', appVersion: '1' }

  it('publishes in the utility process', async () => {
    const worker = { request: vi.fn(async () => result({ kind: 'delta' })) }
    const local = vi.fn(async () => result())
    const publish = workerCatalogPublishing({ worker: worker as never, request, local })
    expect(await publish(false)).toMatchObject({ kind: 'delta' })
    expect(worker.request).toHaveBeenCalledWith({ type: 'catalog', ...request, full: false })
    expect(local).not.toHaveBeenCalled()
  })

  it("falls back to the main process for good, starting with a full catalog, if it can't", async () => {
    const worker = {
      request: vi.fn(async () => {
        throw new WorkerError('could not open the database', 'failed')
      })
    }
    const local = vi.fn(async () => result())
    const publish = workerCatalogPublishing({ worker: worker as never, request, local })
    await publish(false)
    await publish(false)
    expect(local.mock.calls).toEqual([[true], [false]])
    expect(worker.request).toHaveBeenCalledTimes(1)
  })

  it('leaves a crash to the next try (the restarted worker writes a full catalog)', async () => {
    const worker = {
      request: vi.fn(async () => {
        throw new WorkerError('stopped', 'crashed')
      })
    }
    const local = vi.fn(async () => result())
    const publish = workerCatalogPublishing({ worker: worker as never, request, local })
    await expect(publish(false)).rejects.toThrow('stopped')
    expect(local).not.toHaveBeenCalled()
  })
})

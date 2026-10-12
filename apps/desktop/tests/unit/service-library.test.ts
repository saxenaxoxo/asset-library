import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ utilityProcess: {} }))
const { openDatabase } = await import('../../src/main/library/database')
const { migrate } = await import('../../src/main/library/migrations')
const { LibraryRepository } = await import('../../src/main/library/repository')
const { LibraryService } = await import('../../src/main/library/service')
const { WorkerError } = await import('../../src/main/worker/client')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'asset-library-service-'))
  dirs.push(dir)
  return dir
}

type Handler = (
  request: { type: string },
  onBatch?: (entries: unknown[]) => void
) => Promise<unknown>

interface Setup {
  db: ReturnType<typeof openDatabase>
  repo: InstanceType<typeof LibraryRepository>
  service: InstanceType<typeof LibraryService>
  progress: { state: string; message?: string }[]
}

function setup(handler: Handler, mediaDir = '/nonexistent/media'): Setup {
  const db = openDatabase(':memory:')
  migrate(db)
  const repo = new LibraryRepository(db)
  const worker = { request: vi.fn(handler), stop: vi.fn() }
  const progress: { state: string; message?: string }[] = []
  const service = new LibraryService(
    repo,
    worker as never,
    { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    { mediaDir, catalogDir: join(tempDir(), 'catalog'), appVersion: '0.0.0' },
    (event) => {
      if (event.type === 'scan-progress') progress.push(event.progress)
    }
  )
  return { db, repo, service, progress }
}

const file = (relPath: string, fingerprint: string): Record<string, unknown> => ({
  relPath,
  filename: relPath.split('/').pop(),
  size: 10,
  mtimeMs: 1,
  fingerprint
})

describe('LibraryService', () => {
  it('ignores the rest of a scan when its folder is removed mid-scan', async () => {
    let sendBatch: ((entries: unknown[]) => void) | undefined
    let finish: ((value: unknown) => void) | undefined
    const { repo, service, db } = setup((request, onBatch) => {
      if (request.type !== 'scan') return new Promise(() => undefined)
      sendBatch = onBatch
      return new Promise((resolve) => (finish = resolve))
    })
    const root = repo.addRoot('/r', 'r')
    const scanning = service.rescan(root.id)
    sendBatch!([file('a.mp4', 'f1')])
    service.removeRoot(root.id)
    // Before the fix this threw a foreign-key error from inside the worker message handler.
    expect(() => sendBatch!([file('b.mp4', 'f2')])).not.toThrow()
    finish!({ filesSeen: 2, complete: true })
    await scanning
    expect(repo.query({}).total).toBe(0)
    service.stop()
    db.close()
  })

  it('never marks files missing after an incomplete scan', async () => {
    let complete = true
    const { repo, service, progress, db } = setup(async (request, onBatch) => {
      if (request.type !== 'scan') return new Promise(() => undefined)
      onBatch?.(complete ? [file('a.mp4', 'f1'), file('b.mp4', 'f2')] : [file('a.mp4', 'f1')])
      return { filesSeen: 1, complete }
    })
    const root = repo.addRoot('/r', 'r')
    await service.rescan(root.id)
    complete = false
    await service.rescan(root.id)
    expect(repo.query({ missingOnly: true }).total).toBe(0)
    expect(progress.at(-1)?.state).toBe('failed')
    service.stop()
    db.close()
  })

  it('leaves files pending when the worker crashes instead of calling them damaged', async () => {
    const { repo, service, db } = setup(async (request, onBatch) => {
      if (request.type === 'scan') {
        onBatch?.([file('a.mp4', 'f1')])
        return { filesSeen: 1, complete: true }
      }
      if (request.type === 'probe') throw new WorkerError('stopped', 'crashed')
      return new Promise(() => undefined)
    })
    const root = repo.addRoot('/r', 'r')
    await service.rescan(root.id)
    await service.probePending()
    expect(repo.query({}).items[0]?.probeState).toBe('pending')
    service.stop()
    db.close()
  })

  it('cleans up cached media nothing refers to, but keeps recent and referenced files', async () => {
    const mediaDir = tempDir()
    const { repo, service, db } = setup(async (request, onBatch) => {
      if (request.type === 'scan') {
        onBatch?.([file('a.mp4', 'f1')])
        return { filesSeen: 1, complete: true }
      }
      return new Promise(() => undefined)
    }, mediaDir)
    const root = repo.addRoot('/r', 'r')
    await service.rescan(root.id)
    const id = repo.query({}).items[0]!.id
    db.prepare(`update assets set probe_state = 'done' where id = ?`).run(id)
    repo.saveMedia(id, 'f1', { thumb: 'kept.jpg', sprite: null, preview: null, wave: null })
    const old = Date.now() / 1000 - 3600
    for (const name of ['kept.jpg', 'orphan.jpg']) {
      writeFileSync(join(mediaDir, name), 'x')
      utimesSync(join(mediaDir, name), old, old)
    }
    writeFileSync(join(mediaDir, 'in-progress.mp4'), 'x')
    expect(await service.cleanupMedia()).toBe(1)
    expect(readdirSync(mediaDir).sort()).toEqual(['in-progress.mp4', 'kept.jpg'])
    service.stop()
    db.close()
  })

  it('reports which folders are indexing and how many files they have seen', async () => {
    let sendBatch: ((entries: unknown[]) => void) | undefined
    let finish: ((value: unknown) => void) | undefined
    const { repo, service, db } = setup((request, onBatch) => {
      if (request.type !== 'scan') return new Promise(() => undefined)
      sendBatch = onBatch
      return new Promise((resolve) => (finish = resolve))
    })
    const root = repo.addRoot('/r', 'r')
    expect(service.indexing()).toEqual({ rootIds: [], filesSeen: 0 })
    const scanning = service.rescan(root.id)
    sendBatch!([file('a.mp4', 'f1'), file('b.mp4', 'f2')])
    expect(service.indexing()).toEqual({ rootIds: [root.id], filesSeen: 2 })
    finish!({ filesSeen: 2, complete: true })
    await scanning
    expect(service.indexing()).toEqual({ rootIds: [], filesSeen: 0 })
    service.stop()
    db.close()
  })

  it('scans once more when asked to while a scan is running (files just imported)', async () => {
    const finishers: ((value: unknown) => void)[] = []
    const { repo, service, db } = setup((request) => {
      if (request.type !== 'scan') return new Promise(() => undefined)
      return new Promise((resolve) => finishers.push(resolve))
    })
    const root = repo.addRoot('/r', 'r')
    const first = service.rescan(root.id)
    void service.rescan(root.id) // a plain second request is ignored…
    void service.rescan(root.id, true) // …but "again" queues one more scan
    expect(finishers).toHaveLength(1)
    finishers[0]!({ filesSeen: 0, complete: true })
    await first
    await vi.waitFor(() => expect(finishers).toHaveLength(2))
    finishers[1]!({ filesSeen: 0, complete: true })
    await vi.waitFor(() => expect(service.indexing().rootIds).toEqual([]))
    expect(finishers).toHaveLength(2)
    service.stop()
    db.close()
  })

  it('clears the media cache, queues everything again, and drops results made before', async () => {
    const mediaDir = tempDir()
    let finishMedia: ((value: unknown) => void) | undefined
    let mediaJobs = 0
    const { repo, service, db } = setup(async (request, onBatch) => {
      if (request.type === 'scan') {
        onBatch?.([file('a.mp4', 'f1')])
        return { filesSeen: 1, complete: true }
      }
      if (request.type === 'media') {
        mediaJobs++
        return new Promise((resolve) => (finishMedia = resolve))
      }
      return new Promise(() => undefined)
    }, mediaDir)
    const root = repo.addRoot('/r', 'r')
    await service.rescan(root.id)
    const id = repo.query({}).items[0]!.id
    db.prepare(`update assets set probe_state = 'done' where id = ?`).run(id)
    repo.saveMedia(id, 'f1', { thumb: 'old.jpg', sprite: null, preview: null, wave: null })
    writeFileSync(join(mediaDir, 'old.jpg'), 'x'.repeat(10))
    writeFileSync(join(mediaDir, 'orphan.jpg'), 'x'.repeat(5))
    expect(repo.pendingMediaCount()).toBe(0)

    // A job for another (pending) asset is already running when the cache is cleared.
    db.prepare(`update assets set media_state = 'pending', thumb_file = null`).run()
    void service.generateMedia()
    expect(mediaJobs).toBe(1)
    expect(await service.clearMedia()).toEqual({ removed: 2, bytes: 15 })
    expect(readdirSync(mediaDir)).toEqual([])
    expect(repo.pendingMediaCount()).toBe(1)

    // The job that started before the clear finishes: its result is thrown away and redone.
    finishMedia!({ thumb: 'stale.jpg' })
    await vi.waitFor(() => expect(mediaJobs).toBe(2))
    expect(repo.mediaFiles(id)?.thumb).toBeNull()
    finishMedia!({ thumb: 'fresh.jpg' })
    await vi.waitFor(() => expect(repo.mediaFiles(id)?.thumb).toBe('fresh.jpg'))
    expect(repo.pendingMediaCount()).toBe(0)
    service.stop()
    db.close()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ utilityProcess: {} }))
const { openDatabase } = await import('../../src/main/library/database')
const { migrate } = await import('../../src/main/library/migrations')
const { LibraryRepository } = await import('../../src/main/library/repository')
const { LibraryService } = await import('../../src/main/library/service')
const { SKIPPED_DIRECTORIES } = await import('../../src/main/worker/scanner')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const entry = (relPath: string): Record<string, unknown> => ({
  relPath,
  filename: relPath.split('/').pop(),
  size: 10,
  mtimeMs: 1,
  fingerprint: relPath
})

type Db = ReturnType<typeof openDatabase>

function setup(): { db: Db; repo: InstanceType<typeof LibraryRepository> } {
  const db = openDatabase(':memory:')
  migrate(db)
  return { db, repo: new LibraryRepository(db) }
}

/** Indexes files with one complete scan, the way it happened before a folder was skipped. */
function index(
  repo: InstanceType<typeof LibraryRepository>,
  rootId: number,
  paths: string[]
): void {
  const scanId = repo.startScan(rootId)
  repo.applyScanBatch(rootId, scanId, paths.map(entry) as never)
  repo.finishScan(rootId, scanId)
}

const PREVIEWS = '_Mister Horse Previews'

describe('purging assets inside skipped folders', () => {
  it('deletes them with their search rows and tags, at any depth, and keeps the rest', () => {
    const { db, repo } = setup()
    const root = repo.addRoot('/r', 'r')
    index(repo, root.id, [
      `${PREVIEWS}/Titles/Title 01.mp4`,
      `Packs/Pack A/${PREVIEWS}/Clip.mp4`,
      'Packs/Pack A/Clip.mp4',
      // Same name in a file or a different case is not the skipped folder.
      `Packs/${PREVIEWS}.mp4`,
      'Packs/_mister horse previews/Other.mp4',
      'Packs/__MACOSX/._Clip.mp4'
    ])
    const inPreviews = repo.query({ text: 'Title 01' }).items[0]!.id
    repo.addTag(inPreviews, 'only-here')
    repo.saveMedia(inPreviews, `${PREVIEWS}/T`.slice(0, 10), {
      thumb: 'x.thumb.jpg',
      sprite: null,
      preview: null,
      wave: null
    })

    expect(repo.purgeSkippedFolders(SKIPPED_DIRECTORIES)).toBe(3)
    const left = repo
      .query({ includeMissing: true, limit: 50 })
      .items.map((a) => a.relPath)
      .sort()
    expect(left).toEqual([
      'Packs/Pack A/Clip.mp4',
      `Packs/${PREVIEWS}.mp4`,
      'Packs/_mister horse previews/Other.mp4'
    ])
    // Search, tags and media references went with them.
    expect(repo.query({ text: 'Title' }).total).toBe(0)
    expect(db.prepare('select count(*) as n from assets_fts').get()).toEqual({ n: 3 })
    expect(repo.listTags()).toEqual([])
    expect(repo.referencedMediaFiles().has('x.thumb.jpg')).toBe(false)
    db.close()
  })

  it('cleans up the "missing" left by an earlier scan, and only for the asked root', () => {
    const { db, repo } = setup()
    const a = repo.addRoot('/a', 'a')
    const b = repo.addRoot('/b', 'b')
    index(repo, a.id, [`${PREVIEWS}/One.mp4`, 'Keep.mp4'])
    index(repo, b.id, [`${PREVIEWS}/Two.mp4`])
    // The folder became skipped: the next scan didn't see it, so its files went "missing".
    index(repo, a.id, ['Keep.mp4'])
    expect(repo.counts().missing).toBe(1)
    expect(repo.purgeSkippedFolders(SKIPPED_DIRECTORIES, a.id)).toBe(1)
    expect(repo.counts()).toMatchObject({ missing: 0, total: 2 })
    expect(repo.purgeSkippedFolders(SKIPPED_DIRECTORIES)).toBe(1)
    expect(repo.counts().total).toBe(1)
    db.close()
  })

  it('happens at start-up and when a scan of that folder finishes', async () => {
    const { db, repo } = setup()
    const root = repo.addRoot('/r', 'r')
    index(repo, root.id, [`${PREVIEWS}/One.mp4`, `${PREVIEWS}/Two.mp4`, 'Keep.mp4'])
    const catalogDir = mkdtempSync(join(tmpdir(), 'asset-library-skipped-'))
    dirs.push(catalogDir)
    let scans = 0
    const worker = {
      request: vi.fn(async (request: { type: string }, onBatch?: (e: unknown[]) => void) => {
        if (request.type !== 'scan') return new Promise(() => undefined)
        scans++
        onBatch?.([entry('Keep.mp4')])
        return { filesSeen: 1, complete: true }
      }),
      stop: vi.fn()
    }
    const service = new LibraryService(
      repo,
      worker as never,
      { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
      { mediaDir: join(catalogDir, 'media'), catalogDir, appVersion: '0' },
      () => undefined
    )
    service.start()
    expect(repo.counts()).toMatchObject({ total: 1, missing: 0 })

    await vi.waitFor(() => expect(service.indexing().rootIds).toEqual([]))
    expect(scans).toBe(1)

    // Indexed again by an older build, then a scan: nothing ends up "missing".
    index(repo, root.id, [`${PREVIEWS}/Three.mp4`, 'Keep.mp4'])
    expect(repo.counts().total).toBe(2)
    await service.rescan(root.id)
    expect(scans).toBe(2)
    expect(repo.counts()).toMatchObject({ total: 1, missing: 0 })
    service.stop()
    db.close()
  })
})

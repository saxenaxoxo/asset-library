import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PanelRequest } from '@catalog/requests'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { migrate } from '../../src/main/library/migrations'
import { LibraryRepository } from '../../src/main/library/repository'
import {
  formatBytes,
  RequestHandler,
  type RequestLibrary
} from '../../src/main/engine/request-handler'

let db: LibraryDatabase
let repo: LibraryRepository
let dirs: string[]
let library: { [K in keyof RequestLibrary]: Mock<RequestLibrary[K]> }
let setStartAtLogin: Mock<(enabled: boolean) => void>
let importsFolder: string
let handler: RequestHandler

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'asset-library-requests-'))
  dirs.push(dir)
  return dir
}

/** Adds an indexed asset to a root and returns its id. */
function asset(rootId: number, relPath: string): string {
  const scanId = repo.startScan(rootId)
  repo.applyScanBatch(rootId, scanId, [
    { relPath, filename: basename(relPath), size: 10, mtimeMs: 1, fingerprint: relPath }
  ])
  repo.finishScan(rootId, scanId)
  return repo.query({}).items.find((item) => item.relPath === relPath)!.id
}

const run = (request: PanelRequest): ReturnType<RequestHandler['handle']> =>
  handler.handle('1700000000000-abc', request)

beforeEach(() => {
  dirs = []
  db = openDatabase(':memory:')
  migrate(db)
  repo = new LibraryRepository(db)
  importsFolder = join(tempDir(), 'Movies', 'Asset Library Imports')
  library = {
    // Behaves like LibraryService.addRoot: folders only, and records the root.
    addRoot: vi.fn(async (path: string) => {
      if (!statSync(path).isDirectory()) throw new Error('Choose a folder, not a file.')
      return repo.addRoot(path, basename(path))
    }),
    removeRoot: vi.fn((id: number) => repo.removeRoot(id)),
    rescan: vi.fn(async () => undefined),
    rescanAll: vi.fn(),
    organizingChanged: vi.fn(),
    clearMedia: vi.fn(async () => ({ removed: 3, bytes: 1_234_567 }))
  }
  setStartAtLogin = vi.fn()
  handler = new RequestHandler(
    library,
    repo,
    { productName: 'Asset Library', importsFolder, setStartAtLogin },
    () => 42
  )
})

afterEach(() => {
  db.close()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('add-folder', () => {
  it('adds a folder and names it', async () => {
    const dir = join(tempDir(), 'SFX Pack')
    mkdirSync(dir)
    expect(await run({ type: 'add-folder', path: dir })).toEqual({
      id: '1700000000000-abc',
      ok: true,
      message: 'Added SFX Pack',
      at: 42
    })
    expect(repo.listRoots().map((root) => root.path)).toEqual([dir])
  })

  it('explains a folder that is gone, a file, or a relative path', async () => {
    const gone = await run({ type: 'add-folder', path: join(tempDir(), 'Nope') })
    expect(gone).toMatchObject({
      ok: false,
      message: "Couldn't add that folder: it isn't there any more."
    })
    const file = join(tempDir(), 'clip.mov')
    writeFileSync(file, 'x')
    expect(await run({ type: 'add-folder', path: file })).toMatchObject({ ok: false })
    expect(await run({ type: 'add-folder', path: 'relative/folder' })).toMatchObject({ ok: false })
    expect(repo.listRoots()).toEqual([])
  })

  it('says so when the folder is already in the library', async () => {
    const dir = tempDir()
    repo.addRoot(dir, 'Mine')
    expect(await run({ type: 'add-folder', path: dir })).toMatchObject({
      ok: true,
      message: 'Mine is already in the library'
    })
    expect(library.addRoot).not.toHaveBeenCalled()
  })
})

describe('remove-folder and rescan', () => {
  it('removes a folder by id and reassures that files are untouched', async () => {
    const root = repo.addRoot(tempDir(), 'SFX Pack')
    expect(await run({ type: 'remove-folder', rootId: root.id })).toMatchObject({
      ok: true,
      message: "Removed SFX Pack from the library. Your files weren't touched."
    })
    expect(library.removeRoot).toHaveBeenCalledWith(root.id)
    expect(await run({ type: 'remove-folder', rootId: root.id })).toMatchObject({ ok: false })
  })

  it('rescans one folder or all of them', async () => {
    const root = repo.addRoot(tempDir(), 'SFX Pack')
    expect(await run({ type: 'rescan', rootId: root.id })).toMatchObject({
      ok: true,
      message: 'Checking SFX Pack for changes'
    })
    expect(library.rescan).toHaveBeenCalledWith(root.id)
    expect(await run({ type: 'rescan' })).toMatchObject({
      ok: true,
      message: 'Checking 1 library folder for changes'
    })
    expect(library.rescanAll).toHaveBeenCalledOnce()
    expect(await run({ type: 'rescan', rootId: 999 })).toMatchObject({ ok: false })
  })
})

describe('favorites and tags', () => {
  it('sets favorites and tags and refreshes the catalog', async () => {
    const root = repo.addRoot('/lib', 'lib')
    const id = asset(root.id, 'SFX/Whoosh.wav')
    expect(await run({ type: 'set-favorite', id, favorite: true })).toMatchObject({
      ok: true,
      message: 'Added Whoosh.wav to favorites'
    })
    expect(repo.getAsset(id)?.favorite).toBe(true)
    expect(await run({ type: 'add-tag', id, tag: 'impact' })).toMatchObject({ ok: true })
    expect(repo.getAsset(id)?.tags).toEqual(['impact'])
    expect(await run({ type: 'remove-tag', id, tag: 'impact' })).toMatchObject({ ok: true })
    expect(repo.getAsset(id)?.tags).toEqual([])
    expect(await run({ type: 'set-favorite', id, favorite: false })).toMatchObject({
      message: 'Removed Whoosh.wav from favorites'
    })
    expect(library.organizingChanged).toHaveBeenCalledTimes(4)
  })

  it('refuses an asset id that is not in the library', async () => {
    const id = '00000000-0000-0000-0000-000000000000'
    for (const request of [
      { type: 'set-favorite', id, favorite: true },
      { type: 'add-tag', id, tag: 'x' },
      { type: 'remove-tag', id, tag: 'x' }
    ] as PanelRequest[]) {
      expect(await run(request)).toMatchObject({ ok: false })
    }
    expect(library.organizingChanged).not.toHaveBeenCalled()
  })
})

describe('import-files', () => {
  function sources(): { dir: string; clip: string; wav: string; text: string } {
    const dir = tempDir()
    const clip = join(dir, 'clip.mov')
    const wav = join(dir, 'Hit.wav')
    const text = join(dir, 'notes.txt')
    writeFileSync(clip, 'clip')
    writeFileSync(wav, 'wav')
    writeFileSync(text, 'text')
    return { dir, clip, wav, text }
  }

  it('copies into a folder of a library root, never overwriting, and skips the rest', async () => {
    const rootDir = tempDir()
    mkdirSync(join(rootDir, 'SFX'))
    writeFileSync(join(rootDir, 'SFX', 'clip.mov'), 'already here')
    writeFileSync(join(rootDir, 'SFX', 'clip 2.mov'), 'also here')
    const root = repo.addRoot(rootDir, 'Library')
    const { clip, wav, text } = sources()

    const result = await run({
      type: 'import-files',
      files: [clip, wav, text, join(rootDir, 'missing.mov')],
      rootId: root.id,
      folder: 'SFX'
    })
    expect(result).toMatchObject({
      ok: true,
      message:
        "Imported 2 files into SFX. Skipped 1 file that isn't video, audio, an image or a template. Skipped 1 file that couldn't be found."
    })
    expect(readdirSync(join(rootDir, 'SFX')).sort()).toEqual([
      'Hit.wav',
      'clip 2.mov',
      'clip 3.mov',
      'clip.mov'
    ])
    // Existing files are untouched, the copy got the next free name, and sources stay put.
    expect(readFileSync(join(rootDir, 'SFX', 'clip.mov'), 'utf8')).toBe('already here')
    expect(readFileSync(join(rootDir, 'SFX', 'clip 2.mov'), 'utf8')).toBe('also here')
    expect(readFileSync(join(rootDir, 'SFX', 'clip 3.mov'), 'utf8')).toBe('clip')
    expect(readFileSync(clip, 'utf8')).toBe('clip')
    expect(library.rescan).toHaveBeenCalledWith(root.id, true)
  })

  it('copies into the root itself when no folder is given', async () => {
    const rootDir = tempDir()
    const root = repo.addRoot(rootDir, 'Library')
    const { wav } = sources()
    expect(
      await run({ type: 'import-files', files: [wav], rootId: root.id, folder: '' })
    ).toMatchObject({
      ok: true,
      message: 'Imported 1 file into Library.'
    })
    expect(readdirSync(rootDir)).toEqual(['Hit.wav'])
  })

  it('without a destination, uses the Imports folder and adds it to the library', async () => {
    const { clip } = sources()
    expect(await run({ type: 'import-files', files: [clip] })).toMatchObject({
      ok: true,
      message: 'Imported 1 file into Asset Library Imports.'
    })
    expect(readdirSync(importsFolder)).toEqual(['clip.mov'])
    expect(library.addRoot).toHaveBeenCalledWith(importsFolder)
    // Next time the Imports folder is already a root: it's rescanned, not added again.
    expect(await run({ type: 'import-files', files: [clip] })).toMatchObject({ ok: true })
    expect(readdirSync(importsFolder).sort()).toEqual(['clip 2.mov', 'clip.mov'])
    expect(library.addRoot).toHaveBeenCalledOnce()
    expect(library.rescan).toHaveBeenCalledWith(repo.listRoots()[0]!.id, true)
  })

  it('refuses destinations outside the root or missing, and imports nothing', async () => {
    const rootDir = tempDir()
    const outside = tempDir()
    symlinkSync(outside, join(rootDir, 'Shortcut'))
    const root = repo.addRoot(rootDir, 'Library')
    const { clip } = sources()
    for (const folder of ['../escape', 'Missing', 'Shortcut']) {
      const result = await run({ type: 'import-files', files: [clip], rootId: root.id, folder })
      expect(result.ok, folder).toBe(false)
      expect(result.message).toMatch(/^Couldn't import: /)
    }
    expect(
      await run({ type: 'import-files', files: [clip], rootId: 999, folder: '' })
    ).toMatchObject({ ok: false })
    expect(readdirSync(outside)).toEqual([])
    expect(readdirSync(rootDir)).toEqual(['Shortcut'])
  })

  it('reports failure when nothing could be imported', async () => {
    const root = repo.addRoot(tempDir(), 'Library')
    const { text, dir } = sources()
    // A folder with a media-like name is not a regular file.
    mkdirSync(join(dir, 'Folder.mov'))
    const result = await run({
      type: 'import-files',
      files: [text, join(dir, 'Folder.mov'), 'relative.mov'],
      rootId: root.id,
      folder: ''
    })
    expect(result).toMatchObject({
      ok: false,
      message:
        "Nothing was imported. Skipped 1 file that isn't video, audio, an image or a template. Skipped 2 files that couldn't be found."
    })
    expect(library.rescan).not.toHaveBeenCalled()
  })
})

describe('settings and cache', () => {
  it('turns start at login on and off', async () => {
    expect(await run({ type: 'set-settings', startAtLogin: false })).toMatchObject({
      ok: true,
      message: "Asset Library won't start when you log in any more."
    })
    expect(setStartAtLogin).toHaveBeenLastCalledWith(false)
    expect(await run({ type: 'set-settings', startAtLogin: true })).toMatchObject({ ok: true })
    expect(setStartAtLogin).toHaveBeenLastCalledWith(true)
    expect(await run({ type: 'set-settings' })).toMatchObject({ ok: true })
    expect(setStartAtLogin).toHaveBeenCalledTimes(2)
  })

  it('clears the media cache and says how much was freed', async () => {
    expect(await run({ type: 'clear-cache' })).toMatchObject({
      ok: true,
      message: "Cleared 1.2 MB of thumbnails and previews. They'll be made again in the background."
    })
    expect(library.clearMedia).toHaveBeenCalledOnce()
  })

  it('turns an unexpected error into a failed result instead of throwing', async () => {
    library.clearMedia.mockRejectedValueOnce(new Error('disk on fire'))
    expect(await run({ type: 'clear-cache' })).toMatchObject({
      ok: false,
      message: 'Something went wrong: disk on fire'
    })
  })

  it('passes an uninstall on to the app, which asks the editor to confirm', async () => {
    expect(await run({ type: 'uninstall' })).toMatchObject({
      ok: false,
      message: "This copy of the app can't uninstall itself."
    })
    const uninstall = vi.fn()
    const withUninstall = new RequestHandler(
      library,
      repo,
      { productName: 'Asset Library', importsFolder, setStartAtLogin, uninstall },
      () => 42
    )
    expect(await withUninstall.handle('u', { type: 'uninstall' })).toMatchObject({
      ok: true,
      message: 'Confirm on your screen to uninstall Asset Library.'
    })
    expect(uninstall).toHaveBeenCalledOnce()
  })

  it('formats sizes for people', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(12_300)).toBe('12 KB')
    expect(formatBytes(1_234_567)).toBe('1.2 MB')
    expect(formatBytes(5_000_000_000)).toBe('5 GB')
  })
})

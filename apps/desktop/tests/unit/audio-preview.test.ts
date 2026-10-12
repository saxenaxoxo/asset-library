import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basename } from 'path'
import { parseRequest } from '@catalog/requests'
import {
  audioIdFromSearch,
  audioPageUrl,
  parsePlayerTitle,
  playbackProblem,
  playerTitle
} from '@shared/audio-preview'
import { openDatabase, type LibraryDatabase } from '../../src/main/library/database'
import { migrate } from '../../src/main/library/migrations'
import { LibraryRepository } from '../../src/main/library/repository'
import { RequestHandler, type RequestEnvironment } from '../../src/main/engine/request-handler'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('sound player page', () => {
  it('puts only well-formed asset IDs in the page URL', () => {
    expect(audioPageUrl('file:///app/out/renderer/audio.html', ID)).toBe(
      `file:///app/out/renderer/audio.html?id=${ID}`
    )
    expect(audioPageUrl('file:///app/out/renderer/audio.html')).toBe(
      'file:///app/out/renderer/audio.html'
    )
    expect(() => audioPageUrl('file:///a.html', '../../etc/passwd')).toThrow()
    expect(audioIdFromSearch(`?id=${ID}`)).toBe(ID)
    expect(audioIdFromSearch('?id=javascript:alert(1)')).toBeNull()
    expect(audioIdFromSearch('')).toBeNull()
  })

  it('reports its state through the title, and main reads it back', () => {
    for (const state of [
      { state: 'idle' as const },
      { state: 'playing' as const },
      { state: 'ended' as const },
      { state: 'error' as const, code: 4 }
    ]) {
      expect(parsePlayerTitle(playerTitle(state))).toEqual(state)
    }
    expect(parsePlayerTitle('Asset Library')).toBeNull()
    expect(playbackProblem(4)).toBe("this sound format can't be previewed")
    expect(playbackProblem(2)).toBe("the file couldn't be read")
  })
})

describe('play-audio and stop-audio requests', () => {
  let db: LibraryDatabase
  let repo: LibraryRepository
  let audio: { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
  let env: RequestEnvironment

  beforeEach(() => {
    db = openDatabase(':memory:')
    migrate(db)
    repo = new LibraryRepository(db)
    audio = { play: vi.fn(async () => ({ ok: true })), stop: vi.fn() }
    env = {
      productName: 'Asset Library',
      importsFolder: '/imports',
      setStartAtLogin: vi.fn(),
      setCheckForUpdates: vi.fn(),
      audio: audio as never
    }
  })
  afterEach(() => db.close())

  const library = {
    addRoot: vi.fn(),
    removeRoot: vi.fn(),
    rescan: vi.fn(),
    rescanAll: vi.fn(),
    organizingChanged: vi.fn(),
    clearMedia: vi.fn()
  }

  function asset(relPath: string): string {
    const root = repo.listRoots()[0] ?? repo.addRoot('/SFX', 'SFX')
    const scanId = repo.startScan(root.id)
    repo.applyScanBatch(root.id, scanId, [
      { relPath, filename: basename(relPath), size: 1, mtimeMs: 1, fingerprint: relPath }
    ])
    repo.finishScan(root.id, scanId)
    return repo.query({ text: basename(relPath) }).items[0]!.id
  }

  const handle = (text: string, environment = env): ReturnType<RequestHandler['handle']> =>
    new RequestHandler(library as never, repo, environment, () => 7).handle(
      'r1',
      parseRequest(text)!
    )

  it('plays a sound and says which one', async () => {
    const id = asset('Whooshes/Whoosh.wav')
    expect(await handle(`{"type":"play-audio","id":"${id}"}`)).toEqual({
      id: 'r1',
      ok: true,
      message: 'Playing Whoosh.wav',
      at: 7
    })
    expect(audio.play).toHaveBeenCalledWith(id)
  })

  it('stops the sound', async () => {
    expect(await handle('{"type":"stop-audio"}')).toMatchObject({
      ok: true,
      message: 'Stopped the sound'
    })
    expect(audio.stop).toHaveBeenCalledOnce()
  })

  it('explains when it cannot play', async () => {
    const clip = asset('Clips/Clip.mp4')
    expect(await handle(`{"type":"play-audio","id":"${clip}"}`)).toMatchObject({
      ok: false,
      message: "Clip.mp4 isn't a sound file."
    })
    expect(await handle(`{"type":"play-audio","id":"${ID}"}`)).toMatchObject({ ok: false })
    const odd = asset('Odd/Old.aif')
    audio.play.mockResolvedValueOnce({ ok: false, problem: "this sound format can't be previewed" })
    expect(await handle(`{"type":"play-audio","id":"${odd}"}`)).toMatchObject({
      ok: false,
      message: "Couldn't play Old.aif: this sound format can't be previewed."
    })
    repo.setRootStatus(repo.listRoots()[0]!.id, 'offline')
    expect((await handle(`{"type":"play-audio","id":"${odd}"}`)).message).toMatch(
      /isn't available\. Connect its drive/
    )
    const withoutAudio: RequestEnvironment = { ...env, audio: undefined }
    expect(await handle('{"type":"stop-audio"}', withoutAudio)).toMatchObject({ ok: false })
  })

  it('turns the update check on and off', async () => {
    expect(await handle('{"type":"set-settings","checkForUpdates":false}')).toMatchObject({
      ok: true,
      message: "Asset Library won't check for updates."
    })
    expect(env.setCheckForUpdates).toHaveBeenLastCalledWith(false)
    expect(
      await handle('{"type":"set-settings","checkForUpdates":true,"startAtLogin":true}')
    ).toMatchObject({
      message:
        'Asset Library will start when you log in. Asset Library will check for updates once a day.'
    })
  })
})

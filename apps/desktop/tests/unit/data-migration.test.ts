import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENGINE_DATA_FOLDERS } from '@catalog/types'
import { brandIdentity } from '@brand/brand-identity'
import {
  dataMoveNeeded,
  LEGACY_PRODUCT_NAME,
  legacyLinkPending,
  LINK_PENDING_FILE,
  MOVE_LOCK_STALE_MS,
  MOVE_LOCK_WAIT_MS,
  moveDataFolder,
  moveProblem,
  nodeMoveFs,
  retryLegacyLink,
  SPLIT_MARKER_FILE,
  splitLibrary,
  withMoveLock,
  MOVE_LOCK_MAX_AGE_MS,
  type LockClock,
  type MoveFs
} from '../../src/main/engine/data-migration'

let appData: string
let legacy: string
let current: string

/** An old data folder as the app left it: library, settings, catalog, thumbnails, Chromium files. */
function oldLibrary(): void {
  mkdirSync(join(legacy, 'catalog', 'requests'), { recursive: true })
  mkdirSync(join(legacy, 'media'), { recursive: true })
  mkdirSync(join(legacy, 'GPUCache'), { recursive: true })
  writeFileSync(join(legacy, 'library.db'), 'sqlite')
  writeFileSync(join(legacy, 'library.db-wal'), 'wal')
  writeFileSync(join(legacy, 'settings.json'), '{"startAtLogin":true}')
  writeFileSync(join(legacy, 'catalog', 'catalog.json'), '{"version":1,"assets":[]}')
  writeFileSync(join(legacy, 'media', 'thumb.webp'), 'webp')
  writeFileSync(join(legacy, 'Local State'), '{}')
}

beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'asset-library-appdata-'))
  legacy = join(appData, 'Asset Library')
  current = join(appData, 'Goated Panels Hub')
})

afterEach(() => rmSync(appData, { recursive: true, force: true }))

/** Real filesystem, with chosen renames failing. */
function failingFs(fails: (from: string) => boolean): MoveFs {
  const fs = nodeMoveFs()
  return {
    ...fs,
    rename: (from, to) => {
      if (fails(from)) throw new Error(`EBUSY: ${from}`)
      fs.rename(from, to)
    }
  }
}

describe('folder names', () => {
  it('match what the Premiere panel looks for, renamed folder first', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      productName: string
    }
    expect(ENGINE_DATA_FOLDERS).toEqual([pkg.productName, LEGACY_PRODUCT_NAME])
    expect(brandIdentity.hubName).toBe(pkg.productName)
    expect(brandIdentity.primaryProductName).toBe(LEGACY_PRODUCT_NAME)
  })
})

describe('moveDataFolder', () => {
  it('moves the whole folder in one rename and leaves a link under the old name', () => {
    oldLibrary()
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(true)

    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({
      kind: 'moved',
      how: 'folder',
      linked: true
    })
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('sqlite')
    expect(readFileSync(join(current, 'library.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(current, 'media', 'thumb.webp'), 'utf8')).toBe('webp')
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
    // A panel from before the rename reads the old path and gets the same catalog.
    expect(readFileSync(join(legacy, 'catalog', 'catalog.json'), 'utf8')).toBe(
      '{"version":1,"assets":[]}'
    )
  })

  it('replaces the empty folder Electron creates at start-up with the whole old folder', () => {
    oldLibrary()
    mkdirSync(current)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({
      kind: 'moved',
      how: 'folder',
      linked: true
    })
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('sqlite')
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
  })

  it('does nothing on the next launch, or on a new install', () => {
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({ kind: 'none' })
    oldLibrary()
    moveDataFolder(legacy, current, nodeMoveFs())
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({ kind: 'none' })
  })

  it("ignores an old folder with none of the app's data in it", () => {
    mkdirSync(join(legacy, 'GPUCache'), { recursive: true })
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({ kind: 'none' })
    expect(existsSync(current)).toBe(false)
  })

  it('never overwrites a library that is already in the new folder', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'library.db'), 'newer')
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({ kind: 'kept-new' })
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('newer')
    expect(readFileSync(join(legacy, 'library.db'), 'utf8')).toBe('sqlite')
  })

  it("moves only the app's own items when the new folder already exists", () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{"new":true}')
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toEqual({
      kind: 'moved',
      how: 'items',
      linked: true
    })
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('sqlite')
    expect(readFileSync(join(current, 'Local State'), 'utf8')).toBe('{"new":true}')
    // Chromium's caches stay behind; the app's data is gone from the old folder, except for a
    // link to the new catalog folder that a Premiere panel from before the rename reads.
    expect(readdirSync(legacy).sort()).toEqual(['GPUCache', 'Local State', 'catalog'])
    expect(lstatSync(join(legacy, 'catalog')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(legacy, 'catalog', 'catalog.json'), 'utf8')).toContain('"assets"')
    // The link isn't library data: the next launch has nothing to move.
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(false)
  })

  it('retries the catalog link after a one-by-one move, without replacing anything', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    expect(moveDataFolder(legacy, current, noLink())).toMatchObject({ how: 'items', linked: false })
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(true)
    // Something appeared at the old catalog's place: left alone.
    mkdirSync(join(legacy, 'catalog'))
    writeFileSync(join(legacy, 'catalog', 'mine.txt'), 'x')
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('blocked')
    expect(readFileSync(join(legacy, 'catalog', 'mine.txt'), 'utf8')).toBe('x')
    // Once it's gone, the next launch makes the link (and only the catalog's, not the folder's).
    rmSync(join(legacy, 'catalog'), { recursive: true })
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('linked')
    expect(lstatSync(legacy).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(legacy, 'catalog', 'catalog.json'), 'utf8')).toContain('"assets"')
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(false)
  })

  it('changes nothing when the folder rename fails, and runs on the old folder', () => {
    oldLibrary()
    const move = moveDataFolder(
      legacy,
      current,
      failingFs((from) => from === legacy)
    )
    expect(move).toMatchObject({ kind: 'failed', use: 'legacy' })
    expect(readFileSync(join(legacy, 'library.db'), 'utf8')).toBe('sqlite')
    expect(lstatSync(legacy).isDirectory()).toBe(true)
    expect(existsSync(join(current, 'library.db'))).toBe(false)
  })

  it('puts every item back when one of them cannot move', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    const move = moveDataFolder(
      legacy,
      current,
      failingFs((from) => from === join(legacy, 'library.db'))
    )
    expect(move).toMatchObject({ kind: 'failed', use: 'legacy' })
    for (const item of ['catalog', 'media', 'settings.json', 'library.db', 'library.db-wal']) {
      expect(existsSync(join(legacy, item))).toBe(true)
      expect(existsSync(join(current, item))).toBe(false)
    }
  })

  it('still counts as moved when the link under the old name cannot be made', () => {
    oldLibrary()
    const fs: MoveFs = {
      ...nodeMoveFs(),
      linkFolder: () => {
        throw new Error('EPERM')
      }
    }
    expect(moveDataFolder(legacy, current, fs)).toEqual({
      kind: 'moved',
      how: 'folder',
      linked: false
    })
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('sqlite')
    expect(existsSync(legacy)).toBe(false)
  })
})

const noLink = (): MoveFs => ({
  ...nodeMoveFs(),
  linkFolder: () => {
    throw new Error('EPERM')
  }
})

describe('retryLegacyLink', () => {
  it('makes the link on a later launch after it failed during the move', () => {
    oldLibrary()
    expect(moveDataFolder(legacy, current, noLink())).toMatchObject({ linked: false })
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(true)
    // The next launch: nothing to move, but the link is still owed.
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(retryLegacyLink(legacy, current, noLink())).toBe('failed')
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(true)
    // A launch after that succeeds.
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('linked')
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(legacy, 'library.db'), 'utf8')).toBe('sqlite')
    expect(existsSync(join(current, LINK_PENDING_FILE))).toBe(false)
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('not-needed')
  })

  it('never replaces a folder or file that appeared under the old name', () => {
    oldLibrary()
    moveDataFolder(legacy, current, noLink())
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'keep.txt'), 'mine')
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('blocked')
    expect(readFileSync(join(legacy, 'keep.txt'), 'utf8')).toBe('mine')
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(true)
    rmSync(legacy, { recursive: true })
    writeFileSync(legacy, 'a file')
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('blocked')
    expect(readFileSync(legacy, 'utf8')).toBe('a file')
  })

  it('never accepts or replaces a link under the old name that leads somewhere else', () => {
    oldLibrary()
    moveDataFolder(legacy, current, noLink())
    const elsewhere = join(appData, 'elsewhere')
    mkdirSync(elsewhere)
    nodeMoveFs().linkFolder(elsewhere, legacy)
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('blocked')
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(true)
  })

  it('is not needed after a move that made its link', () => {
    oldLibrary()
    moveDataFolder(legacy, current, nodeMoveFs())
    expect(legacyLinkPending(current, nodeMoveFs())).toBe(false)
    expect(retryLegacyLink(legacy, current, nodeMoveFs())).toBe('not-needed')
  })
})

describe('withMoveLock', () => {
  /** A clock that moves on by each sleep, so waiting takes no real time. */
  function fakeClock(
    pid = 100,
    alive: (pid: number) => boolean = () => true,
    start = Date.now()
  ): LockClock {
    let t = start
    return { now: () => t, sleep: (ms) => (t += ms), pid, isAlive: alive }
  }
  let lock: string
  beforeEach(() => {
    lock = join(appData, 'hub.move-lock')
  })

  it('runs the work once and removes its own lock, even when the work fails', () => {
    expect(withMoveLock(lock, nodeMoveFs(), fakeClock(), () => 42)).toBe(42)
    expect(existsSync(lock)).toBe(false)
    expect(() =>
      withMoveLock(lock, nodeMoveFs(), fakeClock(), () => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(existsSync(lock)).toBe(false)
  })

  it('keeps a second launch out while the first one moves, and the second moves nothing', () => {
    const fs = nodeMoveFs()
    let secondRan = false
    const first = withMoveLock(lock, fs, fakeClock(100), () => {
      // The first launch (pid 100) is alive however long the second waits.
      const second = withMoveLock(lock, fs, fakeClock(200), () => (secondRan = true))
      expect(second).toBe('busy')
      expect(existsSync(lock)).toBe(true)
      return 'moved'
    })
    expect(first).toBe('moved')
    expect(secondRan).toBe(false)
    expect(existsSync(lock)).toBe(false)
  })

  it('records its owner, and never removes a lock another launch holds', () => {
    const fs = nodeMoveFs()
    withMoveLock(lock, fs, fakeClock(100), () => {
      expect(readFileSync(lock, 'utf8')).toMatch(/^100 \S+$/)
      // Another launch took the lock over meanwhile (as if this one had been judged gone).
      writeFileSync(lock, '200 theirs')
    })
    expect(readFileSync(lock, 'utf8')).toBe('200 theirs')
  })

  it('takes over a lock whose owner has crashed, however recent', () => {
    writeFileSync(lock, '4242 crashed-launch')
    const clock = fakeClock(100, (pid) => pid !== 4242)
    expect(withMoveLock(lock, nodeMoveFs(), clock, () => 'ran')).toBe('ran')
    expect(existsSync(lock)).toBe(false)
  })

  it('does not take a live owner’s lock by age, unless far older than any move', () => {
    writeFileSync(lock, '4242 live-launch')
    const minuteOld: MoveFs = {
      ...nodeMoveFs(),
      modifiedAt: () => Date.now() - MOVE_LOCK_STALE_MS - 1
    }
    expect(withMoveLock(lock, minuteOld, fakeClock(), () => 'ran')).toBe('busy')
    expect(readFileSync(lock, 'utf8')).toBe('4242 live-launch')
    // Its pid now belongs to some other program: the lock is long abandoned.
    const ancient: MoveFs = {
      ...nodeMoveFs(),
      modifiedAt: () => Date.now() - MOVE_LOCK_MAX_AGE_MS - 1
    }
    expect(withMoveLock(lock, ancient, fakeClock(), () => 'ran')).toBe('ran')
  })

  it('takes over an unreadable lock only once it is old', () => {
    writeFileSync(lock, 'garbage')
    // Rewritten all the time (a live owner whose file just can't be parsed): never taken.
    const clock = fakeClock()
    const fresh: MoveFs = { ...nodeMoveFs(), modifiedAt: () => clock.now() }
    expect(withMoveLock(lock, fresh, clock, () => 'ran')).toBe('busy')
    expect(readFileSync(lock, 'utf8')).toBe('garbage')
    // Left alone past the stale age (a launch that crashed): taken over within the wait.
    expect(withMoveLock(lock, nodeMoveFs(), fakeClock(), () => 'ran')).toBe('ran')
  })

  it('gives up instead of spinning when an abandoned lock cannot be removed', () => {
    writeFileSync(lock, '4242 crashed-launch')
    const stuck: MoveFs = {
      ...nodeMoveFs(),
      removeFile: () => {
        throw new Error('EPERM')
      }
    }
    expect(
      withMoveLock(
        lock,
        stuck,
        fakeClock(100, () => false),
        () => 'ran'
      )
    ).toBe('busy')
  })

  it('never waits forever or counts as old when the clock moves back', () => {
    writeFileSync(lock, 'garbage')
    let t = Date.now()
    const backwards: LockClock = {
      now: () => t,
      sleep: () => (t -= 60_000),
      pid: 100,
      isAlive: () => true
    }
    expect(withMoveLock(lock, nodeMoveFs(), backwards, () => 'ran')).toBe('busy')
    expect(existsSync(lock)).toBe(true)
  })

  it('waits longer than an unreadable lock takes to go stale', () => {
    expect(MOVE_LOCK_WAIT_MS).toBeGreaterThan(MOVE_LOCK_STALE_MS)
  })
})

describe('crash safety', () => {
  it('recognises a move killed half-way through, and refuses to start on it', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    // What the next launch would see if the process died just before library.db moved
    // (catalog, media and settings.json already in the new folder).
    let atCrash: { needed: boolean; split: string[] | null } | null = null
    const fs = nodeMoveFs()
    const watching: MoveFs = {
      ...fs,
      rename: (from, to) => {
        if (from === join(legacy, 'library.db') && atCrash === null) {
          atCrash = {
            needed: dataMoveNeeded(legacy, current, fs),
            split: splitLibrary(legacy, current, fs)
          }
        }
        fs.rename(from, to)
      }
    }
    expect(moveDataFolder(legacy, current, watching)).toMatchObject({ kind: 'moved' })
    expect(atCrash).toEqual({ needed: false, split: ['catalog', 'media', 'settings.json'] })
  })

  it('moves nothing when the journal cannot be written', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    const noWrite: MoveFs = {
      ...nodeMoveFs(),
      writeText: () => {
        throw new Error('EACCES')
      }
    }
    expect(moveDataFolder(legacy, current, noWrite)).toMatchObject({
      kind: 'failed',
      use: 'legacy',
      stuck: []
    })
    expect(readFileSync(join(legacy, 'library.db'), 'utf8')).toBe('sqlite')
    expect(existsSync(join(current, 'library.db'))).toBe(false)
  })

  it('leaves no journal after a move that completed or was fully put back', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    moveDataFolder(
      legacy,
      current,
      failingFs((from) => from === join(legacy, 'library.db'))
    )
    expect(existsSync(join(current, SPLIT_MARKER_FILE))).toBe(false)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toMatchObject({
      kind: 'moved',
      how: 'items'
    })
    expect(existsSync(join(current, SPLIT_MARKER_FILE))).toBe(false)
  })

  it('still makes the link when the launch was killed between the rename and the link', () => {
    oldLibrary()
    const fs = nodeMoveFs()
    // What the next launch would see if the process died right after the rename.
    let pendingAtCrash: boolean | null = null
    const watching: MoveFs = {
      ...fs,
      linkFolder: (target, path) => {
        pendingAtCrash = legacyLinkPending(current, fs)
        fs.linkFolder(target, path)
      }
    }
    expect(moveDataFolder(legacy, current, watching)).toMatchObject({ kind: 'moved', linked: true })
    // The marker travelled with the folder, so a killed launch's link is still owed...
    expect(pendingAtCrash).toBe(true)
    // ...and once the link is made, nothing is owed any more.
    expect(legacyLinkPending(current, fs)).toBe(false)
    expect(existsSync(join(current, LINK_PENDING_FILE))).toBe(false)
  })

  it('leaves no marker behind in the old folder when the rename fails', () => {
    oldLibrary()
    moveDataFolder(
      legacy,
      current,
      failingFs((from) => from === legacy)
    )
    expect(existsSync(join(legacy, LINK_PENDING_FILE))).toBe(false)
  })
})

describe('interrupted moves', () => {
  it('reports a move that failed cleanly, and never as a success', () => {
    oldLibrary()
    const move = moveDataFolder(
      legacy,
      current,
      failingFs((from) => from === legacy)
    )
    expect(move).toMatchObject({ kind: 'failed', use: 'legacy', stuck: [] })
    const problem = moveProblem(move, legacy, current)
    expect(problem?.log).toContain("Couldn't move the data folder")
    expect(problem?.log).toContain('trying again next launch')
    // The library is whole in the old folder: the app runs there, no need to alarm the editor.
    expect(problem?.tellUser).toBeNull()
    expect(moveProblem({ kind: 'moved', how: 'folder', linked: true }, legacy, current)).toBeNull()
  })

  it('refuses to start on a library that was split when putting items back failed', () => {
    oldLibrary()
    mkdirSync(current)
    writeFileSync(join(current, 'Local State'), '{}')
    // library.db-wal can't move, and then library.db can't be put back.
    const fs = failingFs(
      (from) => from === join(legacy, 'library.db-wal') || from === join(current, 'library.db')
    )
    const move = moveDataFolder(legacy, current, fs)
    expect(move).toMatchObject({ kind: 'failed', stuck: ['library.db'] })
    const problem = moveProblem(move, legacy, current)
    expect(problem?.tellUser).toContain('library.db')
    expect(problem?.tellUser).toContain('Nothing was deleted')
    // Nothing is lost: every item is in one of the two folders.
    expect(readFileSync(join(current, 'library.db'), 'utf8')).toBe('sqlite')
    expect(readFileSync(join(legacy, 'library.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(legacy, 'settings.json'), 'utf8')).toBe('{"startAtLogin":true}')
    expect(existsSync(join(current, SPLIT_MARKER_FILE))).toBe(true)

    // Later launches keep refusing until it's back in one place.
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(false)
    expect(splitLibrary(legacy, current, nodeMoveFs())).toEqual(['library.db'])

    // The editor moves it back as told: the marker clears and the move runs again.
    nodeMoveFs().rename(join(current, 'library.db'), join(legacy, 'library.db'))
    expect(splitLibrary(legacy, current, nodeMoveFs())).toBeNull()
    expect(existsSync(join(current, SPLIT_MARKER_FILE))).toBe(false)
    expect(dataMoveNeeded(legacy, current, nodeMoveFs())).toBe(true)
    expect(moveDataFolder(legacy, current, nodeMoveFs())).toMatchObject({ kind: 'moved' })
    expect(readFileSync(join(current, 'library.db-wal'), 'utf8')).toBe('wal')
  })

  it('has no split library when there is no marker', () => {
    oldLibrary()
    expect(splitLibrary(legacy, current, nodeMoveFs())).toBeNull()
  })
})

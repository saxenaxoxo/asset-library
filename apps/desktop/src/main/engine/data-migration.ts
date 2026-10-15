import * as nodeFs from 'fs'
import nodePath from 'path'

// Moves the app's data folder from its name before the rename to Goated Panels Hub (decision I2):
// `<appData>/Asset Library` → `<appData>/Goated Panels Hub`. Runs once, before anything opens the
// folder. Only the app's own folder is touched, never the editor's files, and nothing is deleted:
// the move is a rename on the same disk, and any failure puts back what was moved.

/** The app's name, and so its data folder's name, before the rename. */
export const LEGACY_PRODUCT_NAME = 'Asset Library'

/** What the app keeps in its data folder. Chromium's own caches are left where they are. */
export const OWN_DATA_ITEMS = [
  'catalog',
  'media',
  'settings.json',
  'library.db.bak',
  'library.db',
  'library.db-wal',
  'library.db-shm'
] as const

export interface MoveFs {
  exists(path: string): boolean
  /** True for a symbolic link or Windows junction (never followed). */
  isLink(path: string): boolean
  rename(from: string, to: string): void
  mkdir(path: string): void
  /** Removes a folder only if it's empty (never deletes anything inside one). */
  removeEmptyDir(path: string): void
  /** Makes `path` a link to the folder `target`. */
  linkFolder(target: string, path: string): void
  writeText(path: string, text: string): void
  /** A file's text, or null when it can't be read. */
  readText(path: string): string | null
  /** The path with every link resolved, or null when it doesn't resolve. */
  realPath(path: string): string | null
  /** Removes a file (never a folder). */
  removeFile(path: string): void
  /** Creates a file only if nothing is there yet. False when something already is. */
  createExclusive(path: string, text: string): boolean
  /** Last-modified time in ms, or null when the path doesn't exist. */
  modifiedAt(path: string): number | null
}

export function nodeMoveFs(platform: NodeJS.Platform = process.platform): MoveFs {
  return {
    exists: (path) => {
      try {
        nodeFs.lstatSync(path)
        return true
      } catch {
        return false
      }
    },
    isLink: (path) => {
      try {
        return nodeFs.lstatSync(path).isSymbolicLink()
      } catch {
        return false
      }
    },
    rename: (from, to) => nodeFs.renameSync(from, to),
    mkdir: (path) => nodeFs.mkdirSync(path, { recursive: true }),
    removeEmptyDir: (path) => nodeFs.rmdirSync(path),
    // A junction needs no administrator rights on Windows.
    linkFolder: (target, path) =>
      nodeFs.symlinkSync(target, path, platform === 'win32' ? 'junction' : 'dir'),
    writeText: (path, text) => nodeFs.writeFileSync(path, text),
    readText: (path) => {
      try {
        return nodeFs.readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    realPath: (path) => {
      try {
        return nodeFs.realpathSync(path)
      } catch {
        return null
      }
    },
    removeFile: (path) => nodeFs.unlinkSync(path),
    createExclusive: (path, text) => {
      try {
        nodeFs.writeFileSync(path, text, { flag: 'wx' })
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
    },
    modifiedAt: (path) => {
      try {
        return nodeFs.lstatSync(path).mtimeMs
      } catch {
        return null
      }
    }
  }
}

export type DataMove =
  /** No old data folder (a new install), or it was moved before. */
  | { kind: 'none' }
  /** Both folders hold a library; the new one is used and the old one is left alone. */
  | { kind: 'kept-new' }
  /**
   * The data now lives in the new folder. `linked`: the old folder's name (or, after a one-by-one
   * move, its catalog folder) points at the new one, so a Premiere panel that only knows the old
   * place still finds the catalog.
   */
  | { kind: 'moved'; how: 'folder' | 'items'; linked: boolean }
  /**
   * Nothing usable moved; run on `use` this time and try again next launch. `stuck`: items that
   * moved and couldn't be put back, so the library is split between the two folders.
   */
  | { kind: 'failed'; use: 'legacy' | 'new'; reason: string; stuck: string[] }

/**
 * Left in the new folder when the link under the old name couldn't be made, so a later launch
 * tries again. Not part of the library (see OWN_DATA_ITEMS).
 */
export const LINK_PENDING_FILE = 'legacy-link-pending'

/**
 * Written to the new folder before items are moved one by one, and removed once they all moved
 * or all went back. If it's still there (a failed put-back, or the app was killed mid-move),
 * later launches refuse to start on half a library until it's back in one folder.
 */
export const SPLIT_MARKER_FILE = 'library-move-incomplete'

const own = (dir: string, fs: MoveFs): string[] =>
  OWN_DATA_ITEMS.filter((item) => {
    const path = nodePath.join(dir, item)
    return fs.exists(path) && !fs.isLink(path)
  })

/** True when the old folder holds the app's data and the new one doesn't yet. */
export function dataMoveNeeded(legacyDir: string, dataDir: string, fs: MoveFs): boolean {
  if (!fs.exists(legacyDir) || fs.isLink(legacyDir)) return false
  return own(legacyDir, fs).length > 0 && own(dataDir, fs).length === 0
}

/**
 * Moves the data. Call only while no copy of the old app is running (see legacy-install.ts),
 * and before this app opens the folder.
 */
export function moveDataFolder(legacyDir: string, dataDir: string, fs: MoveFs): DataMove {
  if (!fs.exists(legacyDir) || fs.isLink(legacyDir)) return { kind: 'none' }
  const items = own(legacyDir, fs)
  if (items.length === 0) return { kind: 'none' }
  if (own(dataDir, fs).length > 0) return { kind: 'kept-new' }

  // Electron creates the data folder, empty, before the app's code runs. An empty folder is
  // removed so one rename can move everything at once.
  if (fs.exists(dataDir) && !fs.isLink(dataDir)) {
    try {
      fs.removeEmptyDir(dataDir)
    } catch {
      // Not empty: the items are moved one by one below.
    }
  }
  if (!fs.exists(dataDir)) {
    // The link is owed from the moment the folder moves: the marker travels with the folder, so
    // a launch killed between the rename and the link still makes it next time (retryLegacyLink).
    const legacyMarker = nodePath.join(legacyDir, LINK_PENDING_FILE)
    try {
      fs.writeText(legacyMarker, legacyDir)
    } catch {
      // Only the retry after a crash is lost; the move itself is unaffected.
    }
    try {
      fs.mkdir(nodePath.dirname(dataDir))
      fs.rename(legacyDir, dataDir)
    } catch (error) {
      removeQuietly(legacyMarker, fs)
      return { kind: 'failed', use: 'legacy', reason: (error as Error).message, stuck: [] }
    }
    let linked = false
    try {
      fs.linkFolder(dataDir, legacyDir)
      linked = true
    } catch {
      // Until a later launch makes it, panels from before the rename need their update to find
      // the catalog. Rewritten in case the marker couldn't travel with the folder.
      try {
        fs.writeText(nodePath.join(dataDir, LINK_PENDING_FILE), legacyDir)
      } catch {
        // The data has moved either way; only the retry is lost.
      }
    }
    if (linked) removeQuietly(nodePath.join(dataDir, LINK_PENDING_FILE), fs)
    return { kind: 'moved', how: 'folder', linked }
  }

  // The new folder exists but holds none of our data: move our items one by one, and put them
  // all back if one can't move. The old folder stays a real folder (Chromium's caches remain).
  const journal = nodePath.join(dataDir, SPLIT_MARKER_FILE)
  try {
    fs.writeText(journal, items.join('\n'))
  } catch (error) {
    // Without it a crash mid-move couldn't be recognised later, so nothing is moved.
    return { kind: 'failed', use: 'legacy', reason: (error as Error).message, stuck: [] }
  }
  const moved: string[] = []
  for (const item of items) {
    try {
      fs.rename(nodePath.join(legacyDir, item), nodePath.join(dataDir, item))
      moved.push(item)
    } catch (error) {
      const stuck = moved.reverse().filter((done) => {
        try {
          fs.rename(nodePath.join(dataDir, done), nodePath.join(legacyDir, done))
          return false
        } catch {
          return true
        }
      })
      // If something couldn't go back, run where the library database is.
      const use = fs.exists(nodePath.join(dataDir, 'library.db')) ? 'new' : 'legacy'
      const reason =
        stuck.length > 0
          ? `${(error as Error).message} (left in the new folder: ${stuck.join(', ')})`
          : (error as Error).message
      // Everything went back: the library is whole in the old folder again.
      if (stuck.length === 0) removeQuietly(journal, fs)
      return { kind: 'failed', use, reason, stuck }
    }
  }
  removeQuietly(journal, fs)
  // The old folder stays (Chromium's files), so only its catalog folder can point at the new
  // one: that's all a Premiere panel from before the rename reads (catalog, engine.json and
  // requests; thumbnails are absolute paths).
  return { kind: 'moved', how: 'items', linked: linkCatalog(legacyDir, dataDir, fs) }
}

/** Links `<old>/catalog` to the new catalog folder, or leaves a marker to retry it. */
function linkCatalog(legacyDir: string, dataDir: string, fs: MoveFs): boolean {
  const link = nodePath.join(legacyDir, 'catalog')
  if (!fs.exists(link)) {
    try {
      fs.linkFolder(nodePath.join(dataDir, 'catalog'), link)
      return true
    } catch {
      // Retried next launch (below).
    }
  }
  try {
    fs.writeText(nodePath.join(dataDir, LINK_PENDING_FILE), link)
  } catch {
    // The data has moved either way; only the retry is lost.
  }
  return false
}

/** Removes one of the move's own marker files; a leftover is handled by the next launch. */
function removeQuietly(path: string, fs: MoveFs): void {
  try {
    fs.removeFile(path)
  } catch {
    // Already gone, or checked again next launch.
  }
}

/** True when an earlier launch moved the data but couldn't make the link under the old name. */
export function legacyLinkPending(dataDir: string, fs: MoveFs): boolean {
  return fs.exists(nodePath.join(dataDir, LINK_PENDING_FILE))
}

export type LinkRetry =
  /** Nothing to do. */
  | 'not-needed'
  /** The old name now points at the new folder. */
  | 'linked'
  /** Something else is under the old name; it's never replaced. Tried again next launch. */
  | 'blocked'
  /** Making the link failed again; tried again next launch. */
  | 'failed'

/**
 * Makes the link under the old name that the move couldn't make, when the name is free: the
 * whole old folder after a one-rename move, or only its catalog folder after a one-by-one move
 * (the marker says which).
 */
export function retryLegacyLink(legacyDir: string, dataDir: string, fs: MoveFs): LinkRetry {
  const marker = nodePath.join(dataDir, LINK_PENDING_FILE)
  if (!fs.exists(marker)) return 'not-needed'
  const catalogLink = nodePath.join(legacyDir, 'catalog')
  const [link, target] =
    fs.readText(marker)?.trim() === catalogLink
      ? [catalogLink, nodePath.join(dataDir, 'catalog')]
      : [legacyDir, dataDir]
  if (fs.exists(link)) {
    // Never replaced: a real folder or file, or a link that points somewhere else.
    if (!fs.isLink(link)) return 'blocked'
  } else {
    try {
      fs.linkFolder(target, link)
    } catch {
      return 'failed'
    }
  }
  // Cleared only once the old name really leads to the library.
  const resolved = fs.realPath(link)
  if (resolved === null || resolved !== fs.realPath(target)) return 'blocked'
  removeQuietly(marker, fs)
  return 'linked'
}

/**
 * Age after which a lock whose owner can't be identified (an unreadable lock file) is taken
 * over. A live move holds the lock far shorter: at most the wait for the old app to quit
 * (stopLegacyEngine: up to about 30 s on Windows, asked first and then ended outright, with
 * process-check timeouts) and a few renames on one disk. A lock whose owner is known is never taken over by age, only once its owner is gone.
 */
export const MOVE_LOCK_STALE_MS = 60_000
/**
 * How long a launch waits for another launch's move before giving up (it then tells the
 * editor and exits; it never moves anything without the lock). Longer than the stale age, so
 * a crashed launch's unreadable lock is always taken over within it.
 */
export const MOVE_LOCK_WAIT_MS = 75_000
/** A lock this old is taken over even when its owner's pid is in use (by another program). */
export const MOVE_LOCK_MAX_AGE_MS = 10 * 60_000

export interface LockClock {
  now(): number
  sleep(ms: number): void
  /** This process's id, recorded as the lock's owner. */
  pid: number
  /** True when a process with this id is running (or can't be checked). */
  isAlive(pid: number): boolean
}

/** The lock file's contents: the owner's pid and a token unique to this attempt. */
function lockOwner(text: string | null): { pid: number; token: string } | null {
  const match = text ? /^(\d+) (\S+)$/.exec(text.trim()) : null
  if (!match) return null
  const pid = Number(match[1])
  return Number.isInteger(pid) && pid > 0 ? { pid, token: match[2] ?? '' } : null
}

/**
 * Runs `work` while holding an exclusive lock file, so two launches at once (a login start and
 * a click, say) never move the data at the same time. The single-instance lock can't do this:
 * it lives inside the folder being moved. Returns 'busy' if the lock couldn't be had in time;
 * the caller must then not move anything.
 */
export function withMoveLock<T>(
  lockPath: string,
  fs: MoveFs,
  clock: LockClock,
  work: () => T
): T | 'busy' {
  const started = clock.now()
  const token = `${clock.pid}-${started}-${Math.random().toString(36).slice(2)}`
  const mine = `${clock.pid} ${token}`
  for (;;) {
    if (fs.createExclusive(lockPath, mine)) {
      try {
        return work()
      } finally {
        // Only our own lock: never one another launch has taken over meanwhile.
        if (fs.readText(lockPath)?.trim() === mine) removeQuietly(lockPath, fs)
      }
    }
    const text = fs.readText(lockPath)
    if (text !== null) {
      const owner = lockOwner(text)
      const modified = fs.modifiedAt(lockPath)
      const age = modified === null ? 0 : clock.now() - modified
      // Its owner is gone (crashed): take it over. An unreadable lock only by age, and a lock
      // far older than any move (its pid reused by another program) too. A negative age (the
      // clock moved back) never counts as old.
      const abandoned =
        owner !== null
          ? (owner.pid !== clock.pid && !clock.isAlive(owner.pid)) || age > MOVE_LOCK_MAX_AGE_MS
          : age > MOVE_LOCK_STALE_MS
      // Re-read just before removing, so a lock another launch has just re-taken survives.
      // The next attempt still goes through the wait below, so a lock that can't be removed
      // ends in 'busy', never in a tight loop.
      if (abandoned && fs.readText(lockPath) === text) removeQuietly(lockPath, fs)
    }
    // Elapsed time on this launch's clock; a clock moved back can't make it wait forever.
    const waited = clock.now() - started
    if (waited < 0 || waited >= MOVE_LOCK_WAIT_MS) return 'busy'
    clock.sleep(200)
  }
}

/**
 * The library items left in the new folder by a move that stopped half-way, while the rest is
 * still under the old name; null when the library is in one place (the marker is then cleared).
 */
export function splitLibrary(legacyDir: string, dataDir: string, fs: MoveFs): string[] | null {
  const marker = nodePath.join(dataDir, SPLIT_MARKER_FILE)
  if (!fs.exists(marker)) return null
  const legacyHasData =
    fs.exists(legacyDir) && !fs.isLink(legacyDir) && own(legacyDir, fs).length > 0
  const inNew = own(dataDir, fs)
  if (legacyHasData && inNew.length > 0) return inNew
  try {
    fs.removeFile(marker)
  } catch {
    // Checked again next launch, with the same answer.
  }
  return null
}

/** The editor-facing explanation of a split library. */
export function splitMessage(legacyDir: string, dataDir: string, items: string[]): string {
  return (
    `Your library couldn't be moved to its new folder, and some of it couldn't be put back, ` +
    `so the app won't open until it's in one place. Nothing was deleted.\n\n` +
    `Move these items from ${dataDir} back into ${legacyDir}: ${items.join(', ')}. ` +
    `Then open the app again and it will try the move again.`
  )
}

/**
 * What to say about a move that didn't fully happen: always a log line. When the library ended
 * up split between the two folders, also a message for the editor, and the app must not start
 * (it would write to half a library).
 */
export function moveProblem(
  move: DataMove,
  legacyDir: string,
  dataDir: string
): { log: string; tellUser: string | null } | null {
  if (move.kind !== 'failed') return null
  const running = move.use === 'legacy' ? legacyDir : dataDir
  const log = `Couldn't move the data folder from ${legacyDir} to ${dataDir}: ${move.reason}`
  if (move.stuck.length === 0) {
    return { log: `${log}. Running on ${running}; trying again next launch.`, tellUser: null }
  }
  return {
    log: `${log}. Split between both folders; not starting.`,
    tellUser: splitMessage(legacyDir, dataDir, move.stuck)
  }
}

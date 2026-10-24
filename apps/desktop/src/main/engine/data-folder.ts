import { app, dialog } from 'electron'
import { execFileSync } from 'child_process'
import { readFileSync, readlinkSync } from 'fs'
import { join } from 'path'
import {
  dataMoveNeeded,
  LEGACY_PRODUCT_NAME,
  legacyLinkPending,
  moveDataFolder,
  moveProblem,
  nodeMoveFs,
  retryLegacyLink,
  splitLibrary,
  splitMessage,
  withMoveLock,
  type DataMove
} from './data-migration'
import { stopLegacyEngine } from './legacy-install'

export interface DataFolder {
  /** The data folder's name before the rename (a link to the current one once moved). */
  legacyDir: string
  /**
   * The app runs on the renamed folder after a move on this launch, so OS entries that name the
   * old app need rewriting. False whenever the move didn't happen.
   */
  moved: boolean
  /**
   * A move was needed but didn't finish (it failed, or both folders hold a library). The OS
   * login entry may still name the old app, so it says nothing about the editor's choice.
   */
  moveUnfinished: boolean
  /** The app can't start safely; it has told the editor and is exiting. */
  quit: boolean
  /** The real install's data folder is in use, so leftovers of the old install may be cleaned up. */
  realInstall: boolean
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** True when a process with this id runs (EPERM: it runs, as another user). */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Moves the data folder from its name before the rename (decision I2). Call before anything
 * opens it, including the single-instance lock, which lives inside it.
 */
export function prepareDataFolder(): DataFolder {
  // Automated tests hand the app a throwaway appData folder to exercise the move for real.
  const testAppData = process.env['ASSET_LIBRARY_TEST_APPDATA']
  if (testAppData) {
    app.setPath('appData', testAppData)
    app.setPath('userData', join(testAppData, app.getName()))
  }
  const appData = app.getPath('appData')
  const dataDir = app.getPath('userData')
  const legacyDir = join(appData, LEGACY_PRODUCT_NAME)
  const defaultLocation = dataDir === join(appData, app.getName())
  const result: DataFolder = {
    legacyDir,
    moved: false,
    moveUnfinished: false,
    quit: false,
    realInstall: defaultLocation && !testAppData
  }
  // Only the default location: tests and --user-data-dir runs choose their own folder.
  if (!defaultLocation) return result
  const fs = nodeMoveFs()
  const quit = (title: string, message: string): DataFolder => {
    dialog.showErrorBox(title, message)
    app.exit(0)
    return { ...result, quit: true }
  }
  const splitTitle = `${app.getName()} can't open your library`
  const split = splitLibrary(legacyDir, dataDir, fs)
  if (split) return quit(splitTitle, splitMessage(legacyDir, dataDir, split))
  if (!dataMoveNeeded(legacyDir, dataDir, fs) && !legacyLinkPending(dataDir, fs)) return result
  // A development run (`pnpm dev`) shares the installed app's data folder. It never moves the
  // real library: it uses it where it is, as before the rename. Only installed builds move it.
  if (!app.isPackaged && !testAppData) {
    if (dataMoveNeeded(legacyDir, dataDir, fs)) app.setPath('userData', legacyDir)
    return result
  }

  // Two launches at once (a login start and a click) must not both move the data; the
  // single-instance lock can't guard this, as it lives inside the folder being moved.
  const lockPath = join(appData, `${app.getName()}.move-lock`)
  const outcome = withMoveLock(
    lockPath,
    fs,
    { now: () => Date.now(), sleep, pid: process.pid, isAlive: processAlive },
    () => moveOnce(legacyDir, dataDir, fs)
  )
  if (outcome === 'busy') {
    return quit(
      `${app.getName()} is still starting`,
      `Another copy of ${app.getName()} is moving your library to its new folder. Wait a moment, then open ${app.getName()} again.`
    )
  }
  if (outcome === 'still-running') {
    const name = app.getName()
    return quit(
      `${LEGACY_PRODUCT_NAME} is still running`,
      `Quit ${LEGACY_PRODUCT_NAME} from its icon in the menu bar (Windows: the notification area), then open ${name} again. Your library moves over to ${name} when it opens.`
    )
  }
  if (outcome === 'link-retried' || outcome === 'nothing') return result
  const problem = moveProblem(outcome, legacyDir, dataDir)
  if (problem) console.error(problem.log)
  if (problem?.tellUser) return quit(splitTitle, problem.tellUser)
  // Nothing moved: run on the old folder this time (the Premiere panel still finds it there).
  if (outcome.kind === 'failed' && outcome.use === 'legacy') app.setPath('userData', legacyDir)
  return { ...result, moved: outcome.kind === 'moved', moveUnfinished: outcome.kind !== 'moved' }
}

/** The move itself, under the lock: everything is checked again, as another launch may have
 * moved the data while this one waited. */
function moveOnce(
  legacyDir: string,
  dataDir: string,
  fs: ReturnType<typeof nodeMoveFs>
): DataMove | 'still-running' | 'link-retried' | 'nothing' {
  if (!dataMoveNeeded(legacyDir, dataDir, fs)) {
    const retry = retryLegacyLink(legacyDir, dataDir, fs)
    if (retry === 'blocked' || retry === 'failed') {
      console.warn(`Couldn't link ${legacyDir} to ${dataDir} (${retry}); trying again next launch.`)
    }
    return retry === 'not-needed' ? 'nothing' : 'link-retried'
  }
  const engine = stopLegacyEngine({
    platform: process.platform,
    legacyDir,
    ownPid: process.pid,
    mayStop: app.isPackaged,
    readLink: (path) => {
      try {
        return readlinkSync(path)
      } catch {
        return null
      }
    },
    readText,
    isAlive: processAlive,
    commandOf: (pid) => {
      if (process.platform !== 'darwin') return null
      try {
        return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
          encoding: 'utf8',
          timeout: 2000
        }).trim()
      } catch {
        return null
      }
    },
    terminate: (pid) => {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    },
    terminateByName: (executable, force) => {
      try {
        const args = force ? ['/F', '/IM', executable] : ['/IM', executable]
        execFileSync('taskkill', args, { windowsHide: true, timeout: 5000 })
      } catch {
        // Not running, or not ours to stop; the wait below decides.
      }
    },
    sleep,
    now: () => Date.now()
  })
  if (engine === 'still-running') return 'still-running'
  return moveDataFolder(legacyDir, dataDir, fs)
}

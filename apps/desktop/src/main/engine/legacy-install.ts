import nodePath from 'path'
import { ENGINE_STALE_MS, parseEngineStatus } from '@catalog/requests'
import { LEGACY_PRODUCT_NAME } from './data-migration'

// The app as it was installed before the rename to Goated Panels Hub (decision I2): stopping its
// engine before the data folder moves, and finding the old macOS app so it can go to the Trash.
// Electron and process access are injected, so the decisions can be tested.

/** The pid in Electron's single-instance lock (a link whose target is "<host>-<pid>"). */
export function lockPid(lockTarget: string | null): number | null {
  const match = lockTarget ? /-(\d+)$/.exec(lockTarget) : null
  const pid = match ? Number(match[1]) : NaN
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/** True for the old app's executable (macOS path or Windows file name). */
export function isLegacyExecutable(command: string | null): boolean {
  if (!command) return false
  const name = command.split(/[\\/]/).pop() ?? ''
  return (
    name === LEGACY_PRODUCT_NAME ||
    name.toLowerCase() === `${LEGACY_PRODUCT_NAME}.exe`.toLowerCase()
  )
}

export interface LegacyEngineDeps {
  platform: NodeJS.Platform
  legacyDir: string
  ownPid: number
  /** Installed builds may stop the old engine; development runs never stop anything. */
  mayStop: boolean
  readLink(path: string): string | null
  readText(path: string): string | null
  isAlive(pid: number): boolean
  /** The executable of a running process, or null. */
  commandOf(pid: number): string | null
  /** Asks a process to quit (SIGTERM on macOS). */
  terminate(pid: number): void
  /**
   * Ends the old app by executable name (Windows has no pid to go by): asks it to close, or
   * with `force` ends it outright.
   */
  terminateByName(executable: string, force: boolean): void
  sleep(ms: number): void
  now(): number
}

export type LegacyEngineState = 'not-running' | 'stopped' | 'still-running'

/** How long the old Windows app gets to close when asked, before it's ended outright. */
export const GRACEFUL_QUIT_MS = 5000

/** The old engine's pid on macOS, when its lock names a live process of the old app. */
function legacyPid(d: LegacyEngineDeps): number | null {
  const pid = lockPid(d.readLink(nodePath.join(d.legacyDir, 'SingletonLock')))
  if (pid === null || pid === d.ownPid || !d.isAlive(pid)) return null
  return isLegacyExecutable(d.commandOf(pid)) ? pid : null
}

/** The old engine writes engine.json every few seconds while it runs. */
function heartbeatFresh(d: LegacyEngineDeps): boolean {
  const text = d.readText(nodePath.join(d.legacyDir, 'catalog', 'engine.json'))
  const status = text ? parseEngineStatus(text) : null
  return status !== null && d.now() - status.updatedAt < ENGINE_STALE_MS
}

/**
 * Makes sure no copy of the old app is using the old data folder. Waits for it to quit after
 * asking; a process that won't stop is reported, never worked around.
 */
export function stopLegacyEngine(
  d: LegacyEngineDeps,
  waitMs = ENGINE_STALE_MS + 2000
): LegacyEngineState {
  const running = (): boolean => legacyPid(d) !== null || heartbeatFresh(d)
  if (!running()) return 'not-running'
  if (!d.mayStop) return 'still-running'
  const waitFor = (ms: number): boolean => {
    const until = d.now() + ms
    while (d.now() < until) {
      d.sleep(250)
      if (!running()) return true
    }
    return false
  }
  const pid = legacyPid(d)
  if (pid !== null) d.terminate(pid)
  else if (d.platform === 'win32') {
    // Asked first: the old app then quits as usual (and removes its heartbeat at once). Only if
    // it doesn't is it ended outright, which the data survives (every write is atomic or in
    // SQLite's journal); its heartbeat then takes up to ENGINE_STALE_MS to go stale.
    const exe = `${LEGACY_PRODUCT_NAME}.exe`
    d.terminateByName(exe, false)
    if (waitFor(GRACEFUL_QUIT_MS)) return 'stopped'
    d.terminateByName(exe, true)
  }
  return waitFor(waitMs) ? 'stopped' : 'still-running'
}

/** Where the old macOS app may be installed. */
export function legacyMacAppCandidates(home: string): string[] {
  return [
    `/Applications/${LEGACY_PRODUCT_NAME}.app`,
    nodePath.posix.join(home, 'Applications', `${LEGACY_PRODUCT_NAME}.app`)
  ]
}

/** CFBundleIdentifier from an XML Info.plist, or null (binary plists are skipped). */
export function bundleIdentifier(plist: string | null): string | null {
  const match = plist
    ? /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    : null
  return match?.[1]?.trim() ?? null
}

/**
 * Old "Asset Library.app" copies to move to the Trash: only ones carrying this app's bundle ID,
 * never the running app itself, even when reached through a link. When the running app's own
 * bundle can't be told, nothing is. Same ID, so macOS could otherwise open the old one for
 * assetlibrary:// links or at login.
 */
export function legacyMacApps(
  home: string,
  appId: string,
  ownBundle: string | null,
  readPlist: (bundle: string) => string | null,
  realPath: (path: string) => string | null
): string[] {
  const ownReal = ownBundle ? realPath(ownBundle) : null
  if (ownBundle === null || ownReal === null) return []
  return legacyMacAppCandidates(home).filter((bundle) => {
    if (bundle === ownBundle) return false
    const real = realPath(bundle)
    if (real === null || real === ownReal) return false
    return bundleIdentifier(readPlist(bundle)) === appId
  })
}

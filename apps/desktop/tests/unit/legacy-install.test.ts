import { describe, expect, it } from 'vitest'
import { ENGINE_STALE_MS } from '@catalog/requests'
import {
  bundleIdentifier,
  GRACEFUL_QUIT_MS,
  isLegacyExecutable,
  legacyMacApps,
  lockPid,
  stopLegacyEngine,
  type LegacyEngineDeps
} from '../../src/main/engine/legacy-install'

const LEGACY = '/Users/me/Library/Application Support/Asset Library'
const OLD_EXEC = '/Applications/Asset Library.app/Contents/MacOS/Asset Library'
const APP_ID = 'com.saxenascreation.assetlibrary'

describe('lockPid', () => {
  it("reads the pid from Electron's single-instance lock", () => {
    expect(lockPid('Studio-Mac.local-4321')).toBe(4321)
    expect(lockPid('no-pid-here')).toBeNull()
    expect(lockPid(null)).toBeNull()
  })
})

describe('isLegacyExecutable', () => {
  it('recognises only the old app', () => {
    expect(isLegacyExecutable(OLD_EXEC)).toBe(true)
    expect(isLegacyExecutable('C:\\Programs\\Asset Library\\Asset Library.exe')).toBe(true)
    expect(
      isLegacyExecutable('/Applications/Goated Panels Hub.app/Contents/MacOS/Goated Panels Hub')
    ).toBe(false)
    expect(isLegacyExecutable('/Applications/Electron.app/Contents/MacOS/Electron')).toBe(false)
    expect(isLegacyExecutable(null)).toBe(false)
  })
})

/** A simulated old engine: alive until asked to stop (or never, with `stubborn`). */
function oldEngine(
  options: {
    platform?: NodeJS.Platform
    running?: boolean
    heartbeat?: boolean
    stubborn?: boolean
    /** Ignores being asked to close, but can be ended outright (Windows). */
    ignoresClose?: boolean
    mayStop?: boolean
  } = {}
): { deps: LegacyEngineDeps; calls: string[] } {
  const calls: string[] = []
  let alive = options.running ?? true
  let clock = 1_000_000
  const platform = options.platform ?? 'darwin'
  const deps: LegacyEngineDeps = {
    platform,
    legacyDir: LEGACY,
    ownPid: 99,
    mayStop: options.mayStop ?? true,
    readLink: (path) =>
      platform === 'darwin' && path === `${LEGACY}/SingletonLock` ? 'Mac.local-4321' : null,
    readText: (path) =>
      alive && options.heartbeat && path === `${LEGACY}/catalog/engine.json`
        ? JSON.stringify({ updatedAt: clock - 1000, version: '0.4.0' })
        : null,
    isAlive: (pid) => alive && pid === 4321,
    commandOf: (pid) => (pid === 4321 ? OLD_EXEC : null),
    terminate: (pid) => {
      calls.push(`terminate ${pid}`)
      if (!options.stubborn) alive = false
    },
    terminateByName: (name, force) => {
      calls.push(`terminate ${name}${force ? ' (force)' : ''}`)
      if (!options.stubborn && (force || !options.ignoresClose)) alive = false
    },
    sleep: (ms) => {
      clock += ms
    },
    now: () => clock
  }
  return { deps, calls }
}

describe('stopLegacyEngine', () => {
  it('does nothing when the old app is not running', () => {
    const { deps, calls } = oldEngine({ running: false })
    expect(stopLegacyEngine(deps)).toBe('not-running')
    expect(calls).toEqual([])
  })

  it('asks the old macOS app to quit and waits for it', () => {
    const { deps, calls } = oldEngine()
    expect(stopLegacyEngine(deps)).toBe('stopped')
    expect(calls).toEqual(['terminate 4321'])
  })

  it('ends the old Windows app by name when its heartbeat is fresh', () => {
    const { deps, calls } = oldEngine({ platform: 'win32', heartbeat: true })
    expect(stopLegacyEngine(deps)).toBe('stopped')
    expect(calls).toEqual(['terminate Asset Library.exe'])
  })

  it('ends the old Windows app outright only when asking it to close does not work', () => {
    const { deps, calls } = oldEngine({ platform: 'win32', heartbeat: true, ignoresClose: true })
    const started = deps.now()
    expect(stopLegacyEngine(deps)).toBe('stopped')
    expect(calls).toEqual(['terminate Asset Library.exe', 'terminate Asset Library.exe (force)'])
    // It got the whole grace period first.
    expect(deps.now() - started).toBeGreaterThanOrEqual(GRACEFUL_QUIT_MS)
  })

  it('reports a Windows app that survives even being ended outright, after a bounded wait', () => {
    const { deps, calls } = oldEngine({ platform: 'win32', heartbeat: true, stubborn: true })
    const started = deps.now()
    expect(stopLegacyEngine(deps)).toBe('still-running')
    expect(calls).toEqual(['terminate Asset Library.exe', 'terminate Asset Library.exe (force)'])
    expect(deps.now() - started).toBeLessThan(GRACEFUL_QUIT_MS + ENGINE_STALE_MS + 3000)
  })

  it('reports an old app that will not quit instead of moving data under it', () => {
    const { deps } = oldEngine({ stubborn: true })
    expect(stopLegacyEngine(deps)).toBe('still-running')
  })

  it('never stops anything from a development run', () => {
    const { deps, calls } = oldEngine({ mayStop: false })
    expect(stopLegacyEngine(deps)).toBe('still-running')
    expect(calls).toEqual([])
  })

  it('ignores a lock whose pid now belongs to another program', () => {
    const { deps, calls } = oldEngine()
    deps.commandOf = () => '/usr/bin/some-other-tool'
    expect(stopLegacyEngine(deps)).toBe('not-running')
    expect(calls).toEqual([])
  })
})

const plist = (id: string): string =>
  `<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>Asset Library</string><key>CFBundleIdentifier</key>\n  <string>${id}</string></dict></plist>`

describe('legacyMacApps', () => {
  it('reads the bundle ID from an XML Info.plist', () => {
    expect(bundleIdentifier(plist(APP_ID))).toBe(APP_ID)
    expect(bundleIdentifier('bplist00…')).toBeNull()
  })

  const HUB = '/Applications/Goated Panels Hub.app'
  /** Paths as they are; `links` maps a link to where it leads; `missing` don't resolve. */
  const resolver =
    (links: Record<string, string> = {}, missing: string[] = []) =>
    (path: string): string | null =>
      missing.includes(path) ? null : (links[path] ?? path)

  it('finds old copies that carry this app’s bundle ID, in either Applications folder', () => {
    const plists: Record<string, string> = {
      '/Applications/Asset Library.app': plist(APP_ID),
      '/Users/me/Applications/Asset Library.app': plist(APP_ID)
    }
    expect(legacyMacApps('/Users/me', APP_ID, HUB, (b) => plists[b] ?? null, resolver())).toEqual([
      '/Applications/Asset Library.app',
      '/Users/me/Applications/Asset Library.app'
    ])
  })

  it('leaves other apps, unreadable or binary plists, and the running app alone', () => {
    const plists: Record<string, string> = {
      '/Applications/Asset Library.app': plist('com.example.someone-else'),
      '/Users/me/Applications/Asset Library.app': plist(APP_ID)
    }
    expect(legacyMacApps('/Users/me', APP_ID, HUB, (b) => plists[b] ?? null, resolver())).toEqual([
      '/Users/me/Applications/Asset Library.app'
    ])
    const running = '/Users/me/Applications/Asset Library.app'
    expect(
      legacyMacApps('/Users/me', APP_ID, running, (b) => plists[b] ?? null, resolver())
    ).toEqual([])
    expect(legacyMacApps('/Users/me', APP_ID, HUB, () => 'bplist00…', resolver())).toEqual([])
    expect(legacyMacApps('/Users/me', APP_ID, HUB, () => null, resolver())).toEqual([])
  })

  it('never picks the running app when it is reached through a link', () => {
    const plists = { '/Applications/Asset Library.app': plist(APP_ID) }
    // The running app was renamed back to "Asset Library.app" and opened through a link.
    const links = {
      '/Applications/Asset Library.app': '/Volumes/Apps/Hub.app',
      [HUB]: '/Volumes/Apps/Hub.app'
    }
    expect(
      legacyMacApps(
        '/Users/me',
        APP_ID,
        HUB,
        (b) => plists[b as keyof typeof plists] ?? null,
        resolver(links)
      )
    ).toEqual([])
  })

  it('moves nothing when the running app itself cannot be told', () => {
    const plists = { '/Applications/Asset Library.app': plist(APP_ID) }
    const read = (b: string): string | null => plists[b as keyof typeof plists] ?? null
    // Not inside an .app bundle (macAppBundle gave null), or its path doesn't resolve.
    expect(legacyMacApps('/Users/me', APP_ID, null, read, resolver())).toEqual([])
    expect(legacyMacApps('/Users/me', APP_ID, HUB, read, resolver({}, [HUB]))).toEqual([])
    // A candidate that doesn't resolve (gone already) is skipped, not guessed at.
    expect(
      legacyMacApps(
        '/Users/me',
        APP_ID,
        HUB,
        read,
        resolver({}, ['/Applications/Asset Library.app'])
      )
    ).toEqual([])
  })
})

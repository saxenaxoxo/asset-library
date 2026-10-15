import { ENGINE_START_URL } from '@catalog/requests'

/** "assetlibrary": the URL scheme the panel opens to start the engine. */
export const ENGINE_SCHEME = ENGINE_START_URL.slice(0, ENGINE_START_URL.indexOf(':'))
/** Passed by the Windows login item, or by hand, to start without a window. */
export const BACKGROUND_FLAG = '--background'

/** `start` keeps the engine running without a window; `open` also shows the window. */
export type EngineUrlAction = 'start' | 'open'

/** What an `assetlibrary://…` URL asks for, or null for anything else. */
export function engineUrlAction(url: string): EngineUrlAction | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ENGINE_SCHEME}:`) return null
  const what = (parsed.hostname || parsed.pathname).replace(/^\/+|\/+$/g, '').toLowerCase()
  if (what === 'start') return 'start'
  if (what === 'open') return 'open'
  return null
}

/** The first engine URL in a command line (Windows passes the URL as an argument). */
export function engineUrlInArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${ENGINE_SCHEME}:`)) ?? null
}

/**
 * Whether this launch should stay in the background (no window): started at login, with
 * --background, or by the panel opening assetlibrary://start. A normal launch (double-click,
 * tests) shows the installer window.
 */
export function startsInBackground(launch: {
  argv: readonly string[]
  openedAtLogin: boolean
  /** A URL received before start-up finished (macOS delivers it as an event, not in argv). */
  url: string | null
}): boolean {
  if (launch.openedAtLogin || launch.argv.includes(BACKGROUND_FLAG)) return true
  const url = launch.url ?? engineUrlInArgv(launch.argv)
  return url !== null && engineUrlAction(url) === 'start'
}

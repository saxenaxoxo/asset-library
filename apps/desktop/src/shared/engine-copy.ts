import { brandIdentity } from '@brand/brand-identity'

// How the Hub explains itself: it is the engine the Premiere panel needs, so it keeps running in
// the background. One place for the wording, so the window, the menu-bar menu and the dialogs
// say the same thing.

const hub = brandIdentity.hubName
const panel = `${brandIdentity.primaryProductName} panel`

/** Where the Hub's icon lives: "menu bar" on macOS, "notification area" on Windows. */
export function trayPlace(platform: string): string {
  return platform === 'darwin' ? 'menu bar' : 'notification area'
}

/** Where to look for that icon, in words. */
function trayWhere(platform: string): string {
  return platform === 'darwin'
    ? 'the menu bar at the top of your screen'
    : 'the notification area next to the clock'
}

export const engineCopy = {
  /** The window's always-visible status line. */
  runningTitle: `${hub} is running`,
  runningDetail: (platform: string): string =>
    `It's the engine for the ${panel} in Premiere Pro, so keep it running in the background. Closing this window doesn't stop it: it stays in the ${trayPlace(platform)}.`,

  /** The window's Close button: closing it doesn't stop the engine. */
  closeHint: `${hub} keeps running in the background after you close this window.`,

  /** Menu-bar / notification-area icon. */
  trayRunning: `${hub} is running`,
  trayTooltip: (line: string): string => `${hub} is running (${line}). The ${panel} needs it.`,
  trayStartAtLogin: 'Start at login (recommended)',
  trayQuit: 'Quit (the Premiere panel stops updating)…',

  /** Asked before quitting. */
  quitMessage: `Quit ${hub}?`,
  quitDetail: `The ${panel} in Premiere Pro needs ${hub} running. Until you open it again, the panel can't add folders, import files or show new files. You can start it again from the panel or from Applications.`,
  quitConfirm: 'Quit',
  quitCancel: 'Keep running',

  /** Shown once, the first time the window is closed. */
  closedMessage: `${hub} is still running`,
  closedDetail: (platform: string): string =>
    `It keeps the ${panel} in Premiere Pro working, so it stays running in the background. Look for its icon in ${trayWhere(platform)}. To quit, click that icon and choose Quit.`,

  /** After a panel install succeeds. */
  afterInstall: `Keep ${hub} running in the background: the panel needs it.`,

  /** Start at login, explained. */
  startAtLoginLabel: `Start ${hub} when I log in`,
  startAtLoginHint:
    'Recommended. The panel then works as soon as you open Premiere Pro, without opening this app first.'
} as const

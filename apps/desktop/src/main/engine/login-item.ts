import { app } from 'electron'
import { BACKGROUND_FLAG } from './launch'
import type { LoginItem } from './settings'

/**
 * The operating system's "open at login" entry. Only installed builds touch it: in development
 * it would register the bare Electron binary, and test runs set ASSET_LIBRARY_NO_LOGIN_ITEM so
 * they never add the app being tested to the developer's login items.
 */
export function electronLoginItem(platform: NodeJS.Platform = process.platform): LoginItem {
  const active =
    app.isPackaged &&
    !process.env['ASSET_LIBRARY_NO_LOGIN_ITEM'] &&
    (platform === 'darwin' || platform === 'win32')
  // Windows starts the app at login with --background, so it opens without a window. macOS
  // tells the app it was opened at login instead (wasOpenedAtLogin).
  const args = platform === 'win32' ? [BACKGROUND_FLAG] : undefined
  return {
    set(enabled) {
      if (!active) return
      try {
        app.setLoginItemSettings(args ? { openAtLogin: enabled, args } : { openAtLogin: enabled })
      } catch {
        // The OS refused (e.g. a managed Mac). The choice is still remembered.
      }
    },
    get() {
      if (!active) return null
      try {
        return app.getLoginItemSettings(args ? { args } : undefined).openAtLogin
      } catch {
        return null
      }
    }
  }
}

/** True when macOS started the app because it's a login item. */
export function openedAtLogin(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return false
  }
}

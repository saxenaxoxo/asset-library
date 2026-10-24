import nodePath from 'path'
import { macAppBundle, windowsUninstaller } from './uninstaller'

// Only the copy of the app the editor installed may own assetlibrary:// and the login item.
// Otherwise a build lying around (in the project's dist folder, on a mounted disk image, a
// Windows "win-unpacked" folder) can take over, and the Premiere panel keeps starting that
// old copy instead of the one in Applications. That really happened.

export interface CopyFacts {
  platform: NodeJS.Platform
  packaged: boolean
  execPath: string
  home: string
  productName: string
  exists(path: string): boolean
}

/** Whether this running copy is the installed one (Applications on macOS, the installer's folder on Windows). */
export function isInstalledCopy(d: CopyFacts): boolean {
  if (!d.packaged) return false
  if (d.platform === 'darwin') {
    const bundle = macAppBundle(d.execPath)
    if (!bundle) return false
    const folder = nodePath.posix.dirname(bundle)
    return folder === '/Applications' || folder === nodePath.posix.join(d.home, 'Applications')
  }
  // electron-builder's installer puts its uninstaller beside the app; unpacked builds have none.
  if (d.platform === 'win32') return d.exists(windowsUninstaller(d.execPath, d.productName))
  return false
}

/**
 * The installed copy to hand over to when another copy (not installed) was started by the panel
 * or at login, or null. macOS only: there several copies share one bundle ID and the system may
 * pick any of them for assetlibrary://.
 */
export function installedCopyToHandOver(d: CopyFacts): string | null {
  if (d.platform !== 'darwin' || !d.packaged || isInstalledCopy(d)) return null
  const self = macAppBundle(d.execPath)
  const candidates = [
    nodePath.posix.join('/Applications', `${d.productName}.app`),
    nodePath.posix.join(d.home, 'Applications', `${d.productName}.app`)
  ]
  return candidates.find((bundle) => bundle !== self && d.exists(bundle)) ?? null
}

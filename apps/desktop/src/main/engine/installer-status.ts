import nodePath from 'path'
import type { InstallerStatus } from '@shared/api'
import type { PremiereInstall } from './panel-installer'
import { CEP_EXTENSION_ID } from './uninstaller'

// What the installer window shows: Premiere Pro versions and the panel builds they list (from
// Adobe's installer), the panel versions this app carries, and the folders that matter. Paths are
// reported only when they exist, never guessed. File-system access is injected for tests.

export interface InstallerStatusDeps {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  home: string
  appVersion: string
  packaged: boolean
  dataDir: string
  cacheDir: string
  /** Null when Adobe's installer isn't on this computer. */
  inventory(): Promise<PremiereInstall[] | null>
  bundled(): { kind: 'cep' | 'uxp'; version: string }[]
  exists(path: string): boolean
  listDir(path: string): string[]
}

/** Folders where Premiere Pro itself may be installed (each one checked before it's shown). */
export function premiereAppFolders(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  listDir: (path: string) => string[]
): string[] {
  const parent =
    platform === 'darwin'
      ? '/Applications'
      : platform === 'win32'
        ? nodePath.win32.join(env['ProgramFiles'] || 'C:\\Program Files', 'Adobe')
        : null
  if (!parent) return []
  const join = platform === 'win32' ? nodePath.win32.join : nodePath.posix.join
  try {
    return listDir(parent)
      .filter((name) => /^Adobe Premiere Pro\b/.test(name))
      .sort()
      .map((name) => join(parent, name))
  } catch {
    return []
  }
}

/** Where a CEP extension can live: this user's folder first, then the computer-wide ones. */
export function cepExtensionCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string
): string[] {
  if (platform === 'darwin') {
    return [
      nodePath.posix.join(home, 'Library/Application Support/Adobe/CEP/extensions'),
      '/Library/Application Support/Adobe/CEP/extensions'
    ].map((dir) => nodePath.posix.join(dir, CEP_EXTENSION_ID))
  }
  if (platform === 'win32') {
    const roots = [
      env['APPDATA'],
      env['CommonProgramFiles(x86)'] || 'C:\\Program Files (x86)\\Common Files',
      env['CommonProgramFiles'] || 'C:\\Program Files\\Common Files'
    ].filter((root): root is string => Boolean(root))
    return roots.map((root) =>
      nodePath.win32.join(root, 'Adobe', 'CEP', 'extensions', CEP_EXTENSION_ID)
    )
  }
  return []
}

export async function installerStatus(deps: InstallerStatusDeps): Promise<InstallerStatus> {
  const { platform } = deps
  const inventory = await deps.inventory().catch(() => null)
  const bundled = deps.bundled()
  const version = (kind: 'cep' | 'uxp'): string | null =>
    bundled.find((panel) => panel.kind === kind)?.version ?? null
  return {
    appVersion: deps.appVersion,
    platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
    packaged: deps.packaged,
    adobeInstaller: inventory !== null,
    premiere: inventory ?? [],
    bundled: { cep: version('cep'), uxp: version('uxp') },
    locations: {
      premiereApps: premiereAppFolders(platform, deps.env, deps.listDir),
      cepExtensions: cepExtensionCandidates(platform, deps.env, deps.home).filter((path) =>
        deps.exists(path)
      ),
      data: deps.dataDir,
      cache: deps.cacheDir
    }
  }
}

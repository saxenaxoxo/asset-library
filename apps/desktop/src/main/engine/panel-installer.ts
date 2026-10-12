import nodePath from 'path'

// Installs the Premiere Pro panel that ships inside the app, with Adobe's own command-line
// installer (Unified Plugin Installer Agent, part of Creative Cloud). Pure helpers first, then
// the installer itself with the process runner and file checks injected, so tests never run it.

/** The bundled panel: release/Asset-Library-Premiere-<version>.ccx, copied into resources. */
export const BUNDLED_PANEL_FOLDER = 'premiere-panel'
const BUNDLED_PANEL_NAME = /^Asset-Library-Premiere-(\d+(?:\.\d+){1,3})\.ccx$/

/** Where Adobe's installer lives, or null on platforms without one. */
export function upiaPath(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>
): string | null {
  if (platform === 'darwin') {
    return '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent'
  }
  if (platform === 'win32') {
    const common = env['CommonProgramFiles'] || 'C:\\Program Files\\Common Files'
    return nodePath.win32.join(
      common,
      'Adobe',
      'Adobe Desktop Common',
      'RemoteComponents',
      'UPI',
      'UnifiedPluginInstallerAgent',
      'UnifiedPluginInstallerAgent.exe'
    )
  }
  return null
}

export type UpiaCommand =
  { action: 'install'; ccx: string } | { action: 'remove'; name: string } | { action: 'list' }

/** Arguments for the installer: `--install x.ccx` on macOS, `/install x.ccx` on Windows. */
export function upiaArgs(platform: NodeJS.Platform, command: UpiaCommand): string[] {
  const flag = (name: string): string => (platform === 'win32' ? `/${name}` : `--${name}`)
  switch (command.action) {
    case 'install':
      return [flag('install'), command.ccx]
    case 'remove':
      return [flag('remove'), command.name]
    case 'list':
      return [flag('list'), 'all']
  }
}

/** True when the installer's output reports a successful install. */
export function installSucceeded(output: string): boolean {
  return /installation\s+successful/i.test(output)
}

const VERSION = /\d+(?:\.\d+){1,3}/g

/** Every version of the panel `--list all` shows (old versions can be installed side by side). */
export function installedPanelVersions(listOutput: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const named = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i')
  const versions: string[] = []
  for (const line of listOutput.split(/\r?\n/)) {
    const at = line.search(named)
    if (at === -1) continue
    const found = line.slice(at + name.length + 1).match(VERSION)
    const version = found?.at(-1)
    if (version) versions.push(version)
  }
  return versions
}

/**
 * Compares versions like "0.3.14" or "v1.2.0-beta.1": negative when a < b, 0 when equal,
 * positive when a > b. A release is newer than its own pre-releases.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { core: number[]; pre: string } => {
    const [core = '', ...pre] = v.trim().replace(/^v/i, '').split('-')
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre.join('-') }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

/** The newest bundled panel among the files in the resources folder, or null. */
export function bundledPanelFile(
  names: readonly string[]
): { name: string; version: string } | null {
  let best: { name: string; version: string } | null = null
  for (const name of names) {
    const version = BUNDLED_PANEL_NAME.exec(name)?.[1]
    if (version && (!best || compareVersions(version, best.version) > 0)) best = { name, version }
  }
  return best
}

/** Install unless exactly the bundled version is installed (and nothing older beside it). */
export function panelNeedsInstall(bundled: string, installed: readonly string[]): boolean {
  return installed.length !== 1 || installed[0] !== bundled
}

/** The last meaningful line of the installer's output, for an error message. */
export function upiaProblem(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .at(-1)
  return line ? line.slice(0, 200) : 'the installer gave no reason'
}

export interface UpiaRun {
  /** False when the process failed to start, timed out or exited with an error. */
  ok: boolean
  output: string
}

export interface PanelInstallerDeps {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** The app's resources folder in an installed build; null in development (nothing bundled). */
  resourcesDir: string | null
  /** The panel's name in Adobe's installer (its manifest name). */
  panelName: string
  /** Runs a program with an argument array (never a shell). Never rejects. */
  run(file: string, args: string[]): Promise<UpiaRun>
  exists(path: string): boolean
  listFiles(dir: string): string[]
}

export interface PanelInstallResult {
  ok: boolean
  message: string
  version?: string
}

/** How many old copies are removed at most before installing (each remove takes one). */
const MAX_REMOVALS = 5

export class PanelInstaller {
  private running: Promise<PanelInstallResult> | null = null

  constructor(private readonly deps: PanelInstallerDeps) {}

  /** The panel file shipped with this build, or null (development builds have none). */
  bundled(): { path: string; version: string } | null {
    const { resourcesDir } = this.deps
    if (!resourcesDir) return null
    const dir = nodePath.join(resourcesDir, BUNDLED_PANEL_FOLDER)
    let names: string[]
    try {
      names = this.deps.listFiles(dir)
    } catch {
      return null
    }
    const file = bundledPanelFile(names)
    return file ? { path: nodePath.join(dir, file.name), version: file.version } : null
  }

  private agent(): string | null {
    const path = upiaPath(this.deps.platform, this.deps.env)
    return path && this.deps.exists(path) ? path : null
  }

  /** Installed versions of the panel, or null when Adobe's installer isn't there. */
  async installedVersions(): Promise<string[] | null> {
    const agent = this.agent()
    if (!agent) return null
    const listed = await this.deps.run(agent, upiaArgs(this.deps.platform, { action: 'list' }))
    return installedPanelVersions(listed.output, this.deps.panelName)
  }

  /** Removes any installed copies, then installs the bundled panel. Never throws. */
  install(): Promise<PanelInstallResult> {
    this.running ??= this.installNow().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async installNow(): Promise<PanelInstallResult> {
    const bundled = this.bundled()
    if (!bundled) {
      return { ok: false, message: "This copy of the app doesn't include the Premiere Pro panel." }
    }
    const agent = this.agent()
    if (!agent) {
      return {
        ok: false,
        message:
          "Adobe's plug-in installer wasn't found. Install Premiere Pro with the Creative Cloud app, then try again."
      }
    }
    const { platform, panelName } = this.deps
    try {
      // Adobe's installer keeps old versions beside new ones (and Premiere may load an old one),
      // so every installed copy is removed first.
      const before = await this.installedVersions()
      const removals = Math.min(Math.max(before?.length ?? 0, 1), MAX_REMOVALS)
      for (let i = 0; i < removals; i++) {
        await this.deps.run(agent, upiaArgs(platform, { action: 'remove', name: panelName }))
      }
      const installed = await this.deps.run(
        agent,
        upiaArgs(platform, { action: 'install', ccx: bundled.path })
      )
      if (!installSucceeded(installed.output)) {
        return {
          ok: false,
          message: `Couldn't install the Premiere Pro panel: ${upiaProblem(installed.output)}`
        }
      }
      const after = await this.installedVersions()
      if (after && !after.includes(bundled.version)) {
        return {
          ok: false,
          message: `Adobe's installer finished, but Premiere Pro doesn't list panel ${bundled.version}. Try again.`
        }
      }
      return {
        ok: true,
        version: bundled.version,
        message: `Installed the Premiere Pro panel ${bundled.version}. Restart Premiere Pro to use it.`
      }
    } catch (error) {
      return {
        ok: false,
        message: `Couldn't install the Premiere Pro panel: ${(error as Error).message}`
      }
    }
  }

  /**
   * On the first launch of a new build: installs the bundled panel if Premiere doesn't already
   * have exactly that version. Tries once per bundled version (`lastTried` / `recordTry`), so a
   * failure doesn't repeat at every launch; the tray item can always run it again.
   * Returns null when nothing was attempted.
   */
  async installIfNeeded(
    lastTried: string | null,
    recordTry: (version: string) => void
  ): Promise<PanelInstallResult | null> {
    const bundled = this.bundled()
    if (!bundled || lastTried === bundled.version) return null
    const installed = await this.installedVersions()
    // No Adobe installer yet (Premiere not installed): try again at a later launch.
    if (installed === null) return null
    recordTry(bundled.version)
    if (!panelNeedsInstall(bundled.version, installed)) return null
    return this.install()
  }
}

import nodePath from 'path'

// Installs the Premiere Pro panel that ships inside the app, with Adobe's own command-line
// installer (Unified Plugin Installer Agent, part of Creative Cloud). Pure helpers first, then
// the installer itself with the process runner and file checks injected, so tests never run it.

/**
 * The bundled panels, copied into resources: the CEP extension for Premiere Pro 24–26
 * (Asset-Library-Premiere-CEP-<version>.zxp) and the UXP plugin for Premiere 27 and later
 * (Asset-Library-Premiere-<version>.ccx). Adobe's installer handles both kinds.
 */
export const BUNDLED_PANEL_FOLDER = 'premiere-panel'
const BUNDLED_FILES = {
  cep: /^Asset-Library-Premiere-CEP-(\d+(?:\.\d+){1,3})\.zxp$/,
  uxp: /^Asset-Library-Premiere-(\d+(?:\.\d+){1,3})\.ccx$/
} as const
export type PanelKind = keyof typeof BUNDLED_FILES

/** Adobe's installer lists each build under its own name, so they're managed separately. */
export function panelNameFor(kind: PanelKind, productName: string): string {
  return kind === 'cep' ? `${productName} CEP` : productName
}

/** Premiere reads drags from UXP panels from this version; before it, the CEP build is the one. */
const UXP_FROM_MAJOR = 27

/** The Premiere Pro versions Adobe's installer knows about ("… installed for Premiere Pro (ver 26.5.2)"). */
export function premiereVersions(listOutput: string): string[] {
  return [...listOutput.matchAll(/installed for Premiere Pro \(ver (\d+(?:\.\d+)*)\)/g)].map(
    (match) => match[1] as string
  )
}

/** Each Premiere Pro version Adobe's installer lists, with the panel versions it sees there. */
export interface PremiereInstall {
  version: string
  cep: string[]
  uxp: string[]
}

/**
 * Splits `--list all` output into its Premiere Pro sections ("N extensions installed for Premiere
 * Pro (ver 26.5.2)" up to the next "installed for" heading), so several Premiere versions on one
 * computer are reported separately.
 */
export function premiereInventory(listOutput: string, panelName: string): PremiereInstall[] {
  const sections: { version: string; lines: string[] }[] = []
  let current: { version: string; lines: string[] } | null = null
  for (const line of listOutput.split(/\r?\n/)) {
    if (/\binstalled for\b/i.test(line)) {
      const version = /installed for Premiere Pro \(ver (\d+(?:\.\d+)*)\)/.exec(line)?.[1]
      current = version ? { version, lines: [] } : null
      if (current) sections.push(current)
      continue
    }
    current?.lines.push(line)
  }
  return sections.map(({ version, lines }) => {
    const text = lines.join('\n')
    return {
      version,
      cep: installedPanelVersions(text, panelNameFor('cep', panelName)),
      uxp: installedPanelVersions(text, panelNameFor('uxp', panelName))
    }
  })
}

/** Which panel builds the installed Premiere versions need: CEP below 27, UXP from 27. */
export function wantedKinds(versions: readonly string[]): Set<PanelKind> {
  const kinds = new Set<PanelKind>()
  for (const version of versions) {
    const major = Number.parseInt(version, 10) || 0
    kinds.add(major >= UXP_FROM_MAJOR ? 'uxp' : 'cep')
  }
  return kinds
}

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
  { action: 'install'; file: string } | { action: 'remove'; name: string } | { action: 'list' }

/** Arguments for the installer: `--install x.ccx` on macOS, `/install x.ccx` on Windows. */
export function upiaArgs(platform: NodeJS.Platform, command: UpiaCommand): string[] {
  const flag = (name: string): string => (platform === 'win32' ? `/${name}` : `--${name}`)
  switch (command.action) {
    case 'install':
      return [flag('install'), command.file]
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

const VERSION = '\\d+(?:\\.\\d+){1,3}'

/**
 * Every version of the named panel `--list all` shows (old versions can be installed side by
 * side). The version must follow the name directly, so "Asset Library" never matches the line
 * for "Asset Library CEP".
 */
export function installedPanelVersions(listOutput: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const named = new RegExp(`(?:^|\\s)${escaped}\\s+(${VERSION})(?:\\s|$)`, 'i')
  // One copy serves every Premiere Pro version on the machine, so each version counts once.
  const versions = new Set<string>()
  for (const line of listOutput.split(/\r?\n/)) {
    const version = named.exec(line)?.[1]
    if (version) versions.add(version)
  }
  return [...versions]
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

export interface BundledPanel {
  kind: PanelKind
  name: string
  version: string
}

/** The newest bundled file of each kind among the files in the resources folder, CEP first. */
export function bundledPanelFiles(names: readonly string[]): BundledPanel[] {
  const found: BundledPanel[] = []
  for (const kind of Object.keys(BUNDLED_FILES) as PanelKind[]) {
    let best: BundledPanel | null = null
    for (const name of names) {
      const version = BUNDLED_FILES[kind].exec(name)?.[1]
      if (version && (!best || compareVersions(version, best.version) > 0))
        best = { kind, name, version }
    }
    if (best) found.push(best)
  }
  return found
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
  /** Adobe's installer at another path (automated tests use a stand-in). */
  agentPath?: string | null
}

/** A panel file to install in place of the bundled one of its kind (a verified download). */
export interface PanelFile {
  kind: PanelKind
  version: string
  path: string
}

export interface PanelInstallResult {
  ok: boolean
  message: string
  version?: string
}

/** How many old copies are removed at most before installing (each remove takes one). */
const MAX_REMOVALS = 5

export class PanelInstaller {
  /**
   * Installs and removals run one after another, each with its own request: Adobe's installer
   * mustn't get --install and --remove mixed, and a second install (say, a verified download
   * while the start-up install of the bundled copy runs) must not get the first one's result.
   */
  private queue: Promise<unknown> = Promise.resolve()

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => undefined)
    return next
  }

  constructor(private readonly deps: PanelInstallerDeps) {}

  /** The panel files shipped with this build (none in a development build). */
  bundled(): (BundledPanel & { path: string; panelName: string })[] {
    const { resourcesDir, panelName } = this.deps
    if (!resourcesDir) return []
    const dir = nodePath.join(resourcesDir, BUNDLED_PANEL_FOLDER)
    let names: string[]
    try {
      names = this.deps.listFiles(dir)
    } catch {
      return []
    }
    return bundledPanelFiles(names).map((file) => ({
      ...file,
      path: nodePath.join(dir, file.name),
      panelName: panelNameFor(file.kind, panelName)
    }))
  }

  private agent(): string | null {
    const path = this.deps.agentPath || upiaPath(this.deps.platform, this.deps.env)
    return path && this.deps.exists(path) ? path : null
  }

  /**
   * What Adobe's installer reports: the Premiere Pro versions on this machine and the installed
   * versions of each panel kind. Null when the installer itself isn't there.
   */
  async installedVersions(): Promise<
    (Record<PanelKind, string[]> & { premiere: string[] }) | null
  > {
    const agent = this.agent()
    if (!agent) return null
    const listed = await this.deps.run(agent, upiaArgs(this.deps.platform, { action: 'list' }))
    const { panelName } = this.deps
    return {
      premiere: premiereVersions(listed.output),
      cep: installedPanelVersions(listed.output, panelNameFor('cep', panelName)),
      uxp: installedPanelVersions(listed.output, panelNameFor('uxp', panelName))
    }
  }

  /**
   * What Adobe's installer reports for each Premiere Pro version on this computer, or null when
   * the installer itself isn't there.
   */
  async inventory(): Promise<PremiereInstall[] | null> {
    const agent = this.agent()
    if (!agent) return null
    // Report what's there after an install or removal in progress, not halfway through it.
    await this.queue
    const listed = await this.deps.run(agent, upiaArgs(this.deps.platform, { action: 'list' }))
    return premiereInventory(listed.output, this.deps.panelName)
  }

  /**
   * Removes any installed copies, then installs the panel: the builds the installed Premiere
   * versions need, or exactly `kinds` when the editor chose. `files` (verified downloads) replace
   * the bundled file of their kind. Never throws.
   */
  install(
    kinds?: readonly PanelKind[],
    files: readonly PanelFile[] = []
  ): Promise<PanelInstallResult> {
    // The same install asked for twice at once (a double click) runs once.
    const key = JSON.stringify([kinds ?? null, files.map((file) => [file.kind, file.path])])
    if (this.waiting?.key === key) return this.waiting.result
    const result = this.serial(() => {
      if (this.waiting?.result === result) this.waiting = null
      return this.installNow(kinds, files)
    })
    this.waiting = { key, result }
    return result
  }

  /** The install queued but not started yet, so an identical request can share it. */
  private waiting: { key: string; result: Promise<PanelInstallResult> } | null = null

  private async installNow(
    kinds: readonly PanelKind[] | undefined,
    files: readonly PanelFile[]
  ): Promise<PanelInstallResult> {
    const bundles: PanelFile[] = [
      ...files,
      ...this.bundled().filter((bundle) => !files.some((file) => file.kind === bundle.kind))
    ]
    if (bundles.length === 0) {
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
    const { platform } = this.deps
    try {
      const found = await this.installedVersions()
      const premiere = found?.premiere ?? []
      if (premiere.length === 0) {
        return {
          ok: false,
          message:
            "Premiere Pro isn't installed on this computer, so there's nowhere to put the panel."
        }
      }
      const wanted = kinds ? new Set(kinds) : wantedKinds(premiere)
      const needed = bundles.filter((bundle) => wanted.has(bundle.kind))
      if (needed.length === 0) {
        return {
          ok: false,
          message: `This copy of the app has no panel for Premiere Pro ${premiere.join(', ')}.`
        }
      }
      for (const bundle of needed) {
        // Adobe's installer keeps old versions beside new ones (and Premiere may load an old
        // one), so every installed copy of this kind is removed first.
        await this.removeCopies(agent, bundle.kind)
        const installed = await this.deps.run(
          agent,
          upiaArgs(platform, { action: 'install', file: bundle.path })
        )
        if (!installSucceeded(installed.output)) {
          return {
            ok: false,
            message: `Couldn't install the Premiere Pro panel: ${upiaProblem(installed.output)}`
          }
        }
        const after = await this.installedVersions()
        if (after && !after[bundle.kind].includes(bundle.version)) {
          return {
            ok: false,
            message: `Adobe's installer finished, but Premiere Pro doesn't list panel ${bundle.version}. Try again.`
          }
        }
      }
      const version = needed[0]?.version ?? ''
      return {
        ok: true,
        version,
        message: `Installed the Premiere Pro panel ${version}. Restart Premiere Pro to use it.`
      }
    } catch (error) {
      return {
        ok: false,
        message: `Couldn't install the Premiere Pro panel: ${(error as Error).message}`
      }
    }
  }

  /**
   * Removes every installed copy of one build. The list shows each version once even when
   * several copies are installed, so this removes and lists again until none is left (or it
   * stops making progress). Returns the versions still listed.
   */
  private async removeCopies(agent: string, kind: PanelKind): Promise<string[]> {
    const name = panelNameFor(kind, this.deps.panelName)
    let left = (await this.installedVersions())?.[kind] ?? []
    for (let i = 0; i < MAX_REMOVALS && left.length > 0; i++) {
      await this.deps.run(agent, upiaArgs(this.deps.platform, { action: 'remove', name }))
      left = (await this.installedVersions())?.[kind] ?? []
    }
    return left
  }

  /** Removes one build (CEP or UXP), or both (for uninstalling the app). Never throws. */
  removeAll(kinds: readonly PanelKind[] = ['cep', 'uxp']): Promise<PanelInstallResult> {
    return this.serial(() => this.removeAllNow(kinds))
  }

  private async removeAllNow(kinds: readonly PanelKind[]): Promise<PanelInstallResult> {
    const agent = this.agent()
    // Without Adobe's installer there's nothing it could have installed.
    if (!agent) return { ok: true, message: 'No Premiere Pro panel was installed.' }
    try {
      const left: string[] = []
      for (const kind of kinds) left.push(...(await this.removeCopies(agent, kind)))
      if (left.length > 0) {
        return {
          ok: false,
          message: `Adobe's installer didn't remove the Premiere Pro panel ${left.join(', ')}. Remove it in the Creative Cloud app under Stock & Marketplace → Plugins.`
        }
      }
      return { ok: true, message: 'Removed the Premiere Pro panel.' }
    } catch (error) {
      return {
        ok: false,
        message: `Couldn't remove the Premiere Pro panel: ${(error as Error).message}`
      }
    }
  }

  /**
   * On the first launch of a new build: updates a panel the editor already installed if Premiere
   * doesn't have exactly the bundled version. The first install is the editor's choice, made in
   * the installer window. Tries once per bundled version (`lastTried` / `recordTry`), so a
   * failure doesn't repeat at every launch. Returns null when nothing was attempted.
   */
  async installIfNeeded(
    lastTried: string | null,
    recordTry: (version: string) => void
  ): Promise<PanelInstallResult | null> {
    const bundles = this.bundled()
    // Every bundled file carries the build's version; the first stands for the set.
    const version = bundles.map((b) => `${b.kind}:${b.version}`).join(' ')
    if (bundles.length === 0 || lastTried === version) return null
    const installed = await this.installedVersions()
    // No Adobe installer, or no Premiere Pro yet: try again at a later launch.
    if (installed === null || installed.premiere.length === 0) return null
    recordTry(version)
    const outdated = bundles.filter(
      (b) => installed[b.kind].length > 0 && panelNeedsInstall(b.version, installed[b.kind])
    )
    if (outdated.length === 0) return null
    return this.install(outdated.map((b) => b.kind))
  }
}

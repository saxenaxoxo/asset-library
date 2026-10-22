import type { InstallerStatus, InstallProgress } from '@shared/api'
import {
  buildFit,
  installedPanels,
  installState,
  PANEL_BUILDS,
  recommendedBuilds,
  type InstalledPanel,
  type PanelBuild
} from '@shared/installer'

// Turns what main reports into what the installer window shows: the recommendation, the builds
// "Install" will put in place, and the state of the main button. Pure, so it's unit-tested.

export type HostApp = 'premiere' | 'after-effects'
/** "recommended" installs the right build for each detected Premiere version. */
export type Choice = 'recommended' | PanelBuild
export type Busy = 'install' | 'remove' | null

export type PrimaryState =
  | 'checking'
  | 'install'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'update'
  | 'uninstalling'
  | 'failed'
  | 'unsupported'
  | 'unavailable'
  | 'offline'

export interface PrimaryAction {
  state: PrimaryState
  label: string
  disabled: boolean
  /** Why it's disabled, in words. */
  reason?: string
}

export interface InstallPlan {
  /** Premiere Pro versions Adobe's installer reports. */
  versions: string[]
  /** The build each detected version should get (deduplicated). */
  recommended: PanelBuild[]
  /** What "Install" will install. */
  targets: PanelBuild[]
  installed: InstalledPanel[]
  primary: PrimaryAction
  canUninstall: boolean
  /** What's happening right now, in words ("Downloading CEP 0.4.2: 1.2 MB of 3.4 MB"). */
  activity: string | null
  /** Download progress from 0 to 1, from real byte counts; null when nothing is downloading. */
  fraction: number | null
  /** A download in progress can be cancelled (an install can't). */
  canCancel: boolean
}

/** "840 KB", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The version Install would put in place for a build, from a download or the Hub itself. */
export function availableVersion(status: InstallerStatus, build: PanelBuild): string | null {
  return status.available[build]?.version ?? null
}

/** The busy button and the line beside it, from the real progress main reports. */
function busyInstall(progress: InstallProgress): {
  primary: PrimaryAction
  activity: string | null
  fraction: number | null
} {
  if (progress?.phase === 'downloading' && progress.total > 0) {
    const fraction = Math.min(1, progress.received / progress.total)
    const what = progress.build
      ? `${PANEL_BUILDS[progress.build].label} ${progress.version ?? ''}`.trim()
      : 'the panel'
    return {
      primary: disabled('downloading', `Downloading ${Math.floor(fraction * 100)}%`),
      activity: `Downloading ${what}: ${formatBytes(progress.received)} of ${formatBytes(progress.total)}`,
      fraction
    }
  }
  if (progress?.phase === 'verifying') {
    return {
      primary: disabled('installing', 'Verifying…'),
      activity: 'Checking the download against its checksum…',
      fraction: 1
    }
  }
  return {
    primary: disabled('installing', 'Installing…'),
    activity:
      progress?.phase === 'installing' ? "Installing with Adobe's plug-in installer…" : null,
    fraction: null
  }
}

const disabled = (state: PrimaryState, label: string, reason?: string): PrimaryAction => ({
  state,
  label,
  disabled: true,
  ...(reason ? { reason } : {})
})

export function planInstall(
  status: InstallerStatus | null,
  options: {
    app: HostApp
    choice: Choice
    busy: Busy
    failed: boolean
    progress?: InstallProgress
  }
): InstallPlan {
  const versions = status?.premiere.map((host) => host.version) ?? []
  const installed = installedPanels(status?.premiere ?? [])
  const recommended = recommendedBuilds(versions)
  const targets = options.choice === 'recommended' ? recommended : [options.choice]
  const plan = (
    primary: PrimaryAction,
    extra: { activity?: string | null; fraction?: number | null } = {}
  ): InstallPlan => ({
    versions,
    recommended,
    targets,
    installed,
    primary,
    canUninstall: options.app === 'premiere' && installed.length > 0 && options.busy === null,
    activity: extra.activity ?? null,
    fraction: extra.fraction ?? null,
    canCancel: primary.state === 'downloading'
  })

  if (options.app === 'after-effects') {
    return plan(
      disabled('unavailable', 'Not available yet', "There's no After Effects panel to install yet.")
    )
  }
  if (options.busy === 'install') {
    const { primary, ...extra } = busyInstall(options.progress ?? null)
    return plan(primary, extra)
  }
  if (options.busy === 'remove') return plan(disabled('uninstalling', 'Uninstalling…'))
  if (!status) return plan(disabled('checking', 'Checking…'))
  if (!status.packaged && status.catalog.state !== 'ok') {
    return plan(
      disabled(
        'unavailable',
        'Install Asset Library',
        "This development copy doesn't include the panel and couldn't read the download list, so there's nothing to install."
      )
    )
  }
  if (!status.adobeInstaller) {
    return plan(
      disabled(
        'unavailable',
        'Install Asset Library',
        "Adobe's plug-in installer wasn't found. Install or update the Creative Cloud app, then check again."
      )
    )
  }
  if (versions.length === 0) {
    return plan(
      disabled(
        'unavailable',
        'Install Asset Library',
        "Premiere Pro wasn't found on this computer. Install it with the Creative Cloud app first."
      )
    )
  }
  if (targets.length === 0) {
    return plan(
      disabled(
        'unsupported',
        'Unsupported',
        `Asset Library doesn't support Premiere Pro ${versions.join(', ')}.`
      )
    )
  }
  if (options.choice !== 'recommended') {
    const fits = versions.map((version) => buildFit(options.choice as PanelBuild, version))
    if (fits.every((fit) => fit.fit === 'unsupported')) {
      return plan(disabled('unsupported', 'Unsupported', fits[0]?.reason))
    }
  }
  const missing = targets.find((build) => !status.available[build])
  if (missing) {
    const label = PANEL_BUILDS[missing].label
    const { state, message } = status.catalog
    const reason =
      state === 'ok'
        ? `No ${label} build is available to download yet.`
        : state === 'offline'
          ? `You're offline, and this copy of the Hub doesn't include the ${label} build. Connect to the internet, then click Check again.`
          : `This copy of the Hub doesn't include the ${label} build, and the download list couldn't be used${message ? `: ${message}` : '.'}`
    return plan(
      disabled(state === 'offline' ? 'offline' : 'unavailable', 'Install Asset Library', reason)
    )
  }
  if (options.failed) return plan({ state: 'failed', label: 'Try again', disabled: false })

  const states = targets.map((build) =>
    installState(installed, build, availableVersion(status, build))
  )
  if (states.includes('update-available')) {
    const build = targets[states.indexOf('update-available')] as PanelBuild
    return plan({
      state: 'update',
      label: `Update to ${availableVersion(status, build) ?? ''}`.trim(),
      disabled: false
    })
  }
  if (states.every((state) => state === 'installed'))
    return plan(disabled('installed', 'Installed'))
  return plan({ state: 'install', label: 'Install Asset Library', disabled: false })
}

/** True when a card should look selected. */
export function isSelected(
  choice: Choice,
  recommended: readonly PanelBuild[],
  build: PanelBuild
): boolean {
  return choice === 'recommended' ? recommended.includes(build) : choice === build
}

import type { InstallerStatus } from '@shared/api'
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
  | 'installing'
  | 'installed'
  | 'update'
  | 'uninstalling'
  | 'failed'
  | 'unsupported'
  | 'unavailable'

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
}

const disabled = (state: PrimaryState, label: string, reason?: string): PrimaryAction => ({
  state,
  label,
  disabled: true,
  ...(reason ? { reason } : {})
})

export function planInstall(
  status: InstallerStatus | null,
  options: { app: HostApp; choice: Choice; busy: Busy; failed: boolean }
): InstallPlan {
  const versions = status?.premiere.map((host) => host.version) ?? []
  const installed = installedPanels(status?.premiere ?? [])
  const recommended = recommendedBuilds(versions)
  const targets = options.choice === 'recommended' ? recommended : [options.choice]
  const plan = (primary: PrimaryAction): InstallPlan => ({
    versions,
    recommended,
    targets,
    installed,
    primary,
    canUninstall: options.app === 'premiere' && installed.length > 0 && options.busy === null
  })

  if (options.app === 'after-effects') {
    return plan(
      disabled('unavailable', 'Not available yet', "There's no After Effects panel to install yet.")
    )
  }
  if (options.busy === 'install') return plan(disabled('installing', 'Installing…'))
  if (options.busy === 'remove') return plan(disabled('uninstalling', 'Uninstalling…'))
  if (!status) return plan(disabled('checking', 'Checking…'))
  if (!status.packaged) {
    return plan(
      disabled(
        'unavailable',
        'Install Asset Library',
        "This development copy doesn't include the panel, so there's nothing to install."
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
  const missing = targets.find((build) => !status.bundled[build])
  if (missing) {
    return plan(
      disabled(
        'unavailable',
        'Install Asset Library',
        `This copy of the app doesn't include the ${PANEL_BUILDS[missing].label} build.`
      )
    )
  }
  if (options.failed) return plan({ state: 'failed', label: 'Try again', disabled: false })

  const states = targets.map((build) => installState(installed, build, status.bundled[build]))
  if (states.includes('update-available')) {
    const build = targets[states.indexOf('update-available')] as PanelBuild
    return plan({
      state: 'update',
      label: `Update to ${status.bundled[build] ?? ''}`.trim(),
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

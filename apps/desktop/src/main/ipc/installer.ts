import { shell } from 'electron'
import { brandLinks } from '@brand/brand-links'
import { IpcChannel } from '@shared/channels'
import type { ExternalLink, InstallerStatus, RevealTarget } from '@shared/api'
import type { PanelBuild } from '@shared/installer'
import { isAllowedExternalUrl } from '../security-rules'
import { handle, type SenderCheck } from './handle'
import type { PanelInstallResult } from '../engine/panel-installer'

export interface InstallerIpcDependencies {
  status(): Promise<InstallerStatus>
  install(builds?: readonly PanelBuild[]): Promise<PanelInstallResult>
  remove(builds: readonly PanelBuild[]): Promise<PanelInstallResult>
  /** Starts the confirmed uninstall (it asks in a native dialog first). */
  uninstall(): void
}

/** The configured product links. Only these open, and only through the allowlist. */
export function linkUrl(link: ExternalLink): string {
  const repository = brandLinks.repository
  switch (link) {
    case 'repository':
      return repository
    case 'issues':
      return brandLinks.issues
    case 'license':
      return `${repository}/blob/main/LICENSE`
    case 'panel-guide':
      return `${repository}/blob/main/docs/premiere-panel.md`
  }
}

/** The installer window's channels. Paths to reveal come from main's own status, never the window. */
export function registerInstallerHandlers(
  isTrustedSender: SenderCheck,
  deps: InstallerIpcDependencies
): void {
  handle(IpcChannel.getInstallerStatus, isTrustedSender, () => deps.status())

  handle(IpcChannel.installPanel, isTrustedSender, async ({ builds }) => {
    const { ok, message } = await deps.install(builds)
    return { ok, message }
  })

  handle(IpcChannel.removePanel, isTrustedSender, async ({ build }) => {
    const { ok, message } = await deps.remove([build])
    return { ok, message }
  })

  handle(IpcChannel.uninstallApp, isTrustedSender, async () => {
    deps.uninstall()
  })

  handle(IpcChannel.revealLocation, isTrustedSender, async ({ target, index }) => {
    const { locations } = await deps.status()
    const path = revealPath(locations, target, index)
    if (!path) return false
    return (await shell.openPath(path)) === ''
  })

  handle(IpcChannel.openLink, isTrustedSender, async ({ link }) => {
    const url = linkUrl(link)
    if (!isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
}

function revealPath(
  locations: InstallerStatus['locations'],
  target: RevealTarget,
  index: number
): string | null {
  switch (target) {
    case 'premiere-app':
      return locations.premiereApps[index] ?? null
    case 'cep-extension':
      return locations.cepExtensions[index] ?? null
    case 'data':
      return locations.data
    case 'cache':
      return locations.cache
  }
}

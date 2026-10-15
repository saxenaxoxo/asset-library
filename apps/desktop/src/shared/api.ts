import type { IpcRequest, IpcResponse } from './schemas'
import type { PanelBuild } from './installer'
import type { IpcChannel } from './channels'

export type Diagnostics = IpcResponse<typeof IpcChannel.getDiagnostics>
export type InstallerStatus = IpcResponse<typeof IpcChannel.getInstallerStatus>
export type InstallerResult = IpcResponse<typeof IpcChannel.installPanel>
export type RevealTarget = IpcRequest<typeof IpcChannel.revealLocation>['target']
export type ExternalLink = IpcRequest<typeof IpcChannel.openLink>['link']

/** The only surface the renderer can reach. Exposed as `window.assetLibrary` by the preload. */
export interface AssetLibraryApi {
  /** Versions and capabilities of bundled components (SQLite, FTS5, FFprobe), for support. */
  getDiagnostics(): Promise<Diagnostics>

  /** What's installed: Premiere Pro versions, panel builds, bundled versions, folders. */
  getInstallerStatus(): Promise<InstallerStatus>
  /** Installs the bundled panel: the recommended build per Premiere version, or `builds`. */
  installPanel(builds?: PanelBuild[]): Promise<InstallerResult>
  /** Removes every installed copy of one panel build. */
  removePanel(build: PanelBuild): Promise<InstallerResult>
  /** Asks to confirm (native dialog), then removes the app, its panel and optionally its data. */
  uninstallApp(): Promise<void>
  /** Shows a detected folder in Finder/Explorer. Resolves to false when it isn't there. */
  revealLocation(target: RevealTarget, index?: number): Promise<boolean>
  /** Opens one of the configured product links in the browser. */
  openLink(link: ExternalLink): Promise<boolean>
}

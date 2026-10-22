import type { IpcRequest, IpcResponse } from './schemas'
import type { PanelBuild } from './installer'
import type { IpcChannel } from './channels'

export type Diagnostics = IpcResponse<typeof IpcChannel.getDiagnostics>
export type InstallerStatus = IpcResponse<typeof IpcChannel.getInstallerStatus>
export type InstallerResult = IpcResponse<typeof IpcChannel.installPanel>
export type InstallProgress = IpcResponse<typeof IpcChannel.getInstallProgress>
export type RevealTarget = IpcRequest<typeof IpcChannel.revealLocation>['target']
export type ExternalLink = IpcRequest<typeof IpcChannel.openLink>['link']
export type EngineState = IpcResponse<typeof IpcChannel.getEngineState>

/** The only surface the renderer can reach. Exposed as `window.assetLibrary` by the preload. */
export interface AssetLibraryApi {
  /** Versions and capabilities of bundled components (SQLite, FTS5, FFprobe), for support. */
  getDiagnostics(): Promise<Diagnostics>

  /**
   * What's installed and what's available: Premiere Pro versions, panel builds, built-in and
   * downloadable versions, folders. `refresh` reads the download list again.
   */
  getInstallerStatus(options?: { refresh?: boolean }): Promise<InstallerStatus>
  /**
   * Installs the panel (the recommended build per Premiere version, or `builds`), downloading
   * and verifying a newer copy first when the download list has one.
   */
  installPanel(builds?: PanelBuild[]): Promise<InstallerResult>
  /** The download or install in progress, or null. */
  getInstallProgress(): Promise<InstallProgress>
  /** Stops a download in progress (an install that has started can't be stopped). */
  cancelDownload(): Promise<boolean>
  /** Removes every installed copy of one panel build. */
  removePanel(build: PanelBuild): Promise<InstallerResult>
  /** Asks to confirm (native dialog), then removes the app, its panel and optionally its data. */
  uninstallApp(): Promise<void>
  /** Shows a detected folder in Finder/Explorer. Resolves to false when it isn't there. */
  revealLocation(target: RevealTarget, index?: number): Promise<boolean>
  /** Opens one of the configured product links in the browser. */
  openLink(link: ExternalLink): Promise<boolean>
  /** The background engine: what it's doing and whether it starts at login. */
  getEngineState(): Promise<EngineState>
  /** Turns "start at login" on or off, and returns the new state. */
  setStartAtLogin(enabled: boolean): Promise<EngineState>
}

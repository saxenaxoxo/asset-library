/**
 * IPC channel names. Dependency-free so the sandboxed preload can import it.
 * Every request channel needs zod schemas in ./schemas.ts and a handler in src/main/ipc.
 */
export const IpcChannel = {
  getDiagnostics: 'app:get-diagnostics',
  // Installer window: the Premiere Pro panel and the app itself.
  getInstallerStatus: 'installer:get-status',
  installPanel: 'installer:install-panel',
  getInstallProgress: 'installer:get-progress',
  cancelDownload: 'installer:cancel-download',
  removePanel: 'installer:remove-panel',
  uninstallApp: 'installer:uninstall-app',
  revealLocation: 'installer:reveal',
  openLink: 'installer:open-link',
  // The background engine the panel needs: is it on, and does it start at login.
  getEngineState: 'engine:get-state',
  setStartAtLogin: 'engine:set-start-at-login'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

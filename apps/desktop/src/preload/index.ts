import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/channels'
import type { AssetLibraryApi } from '@shared/api'

// Each method maps to exactly one channel. Raw ipcRenderer is never exposed.
const api: AssetLibraryApi = {
  getDiagnostics: () => ipcRenderer.invoke(IpcChannel.getDiagnostics),
  getInstallerStatus: (options) => ipcRenderer.invoke(IpcChannel.getInstallerStatus, options),
  installPanel: (builds) => ipcRenderer.invoke(IpcChannel.installPanel, { builds }),
  getInstallProgress: () => ipcRenderer.invoke(IpcChannel.getInstallProgress),
  cancelDownload: () => ipcRenderer.invoke(IpcChannel.cancelDownload),
  removePanel: (build) => ipcRenderer.invoke(IpcChannel.removePanel, { build }),
  uninstallApp: () => ipcRenderer.invoke(IpcChannel.uninstallApp),
  revealLocation: (target, index) =>
    ipcRenderer.invoke(IpcChannel.revealLocation, { target, index }),
  openLink: (link) => ipcRenderer.invoke(IpcChannel.openLink, { link }),
  getEngineState: () => ipcRenderer.invoke(IpcChannel.getEngineState),
  setStartAtLogin: (enabled) => ipcRenderer.invoke(IpcChannel.setStartAtLogin, { enabled })
}

contextBridge.exposeInMainWorld('assetLibrary', api)

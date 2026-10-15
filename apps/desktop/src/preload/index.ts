import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/channels'
import type { AssetLibraryApi } from '@shared/api'

// Each method maps to exactly one channel. Raw ipcRenderer is never exposed.
const api: AssetLibraryApi = {
  getDiagnostics: () => ipcRenderer.invoke(IpcChannel.getDiagnostics),
  getInstallerStatus: () => ipcRenderer.invoke(IpcChannel.getInstallerStatus),
  installPanel: (builds) => ipcRenderer.invoke(IpcChannel.installPanel, { builds }),
  removePanel: (build) => ipcRenderer.invoke(IpcChannel.removePanel, { build }),
  uninstallApp: () => ipcRenderer.invoke(IpcChannel.uninstallApp),
  revealLocation: (target, index) =>
    ipcRenderer.invoke(IpcChannel.revealLocation, { target, index }),
  openLink: (link) => ipcRenderer.invoke(IpcChannel.openLink, { link })
}

contextBridge.exposeInMainWorld('assetLibrary', api)

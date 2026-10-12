import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/channels'
import type { AssetLibraryApi } from '@shared/api'

// Each method maps to exactly one channel. Raw ipcRenderer is never exposed.
const api: AssetLibraryApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  getDiagnostics: () => ipcRenderer.invoke(IpcChannel.getDiagnostics),
  pickFolder: () => ipcRenderer.invoke(IpcChannel.pickFolder),
  pickDragTestFiles: () => ipcRenderer.invoke(IpcChannel.pickDragTestFiles),
  startDrag: (ids) => ipcRenderer.send(IpcChannel.startDrag, { ids })
}

contextBridge.exposeInMainWorld('assetLibrary', api)

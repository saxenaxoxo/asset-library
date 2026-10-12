import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, LIBRARY_EVENT_CHANNEL } from '@shared/channels'
import type { AssetLibraryApi, LibraryEvent } from '@shared/api'

// Each method maps to exactly one channel. Raw ipcRenderer is never exposed.
const api: AssetLibraryApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  getDiagnostics: () => ipcRenderer.invoke(IpcChannel.getDiagnostics),
  listRoots: () => ipcRenderer.invoke(IpcChannel.listRoots),
  addFolder: () => ipcRenderer.invoke(IpcChannel.addFolder),
  removeRoot: (id) => ipcRenderer.invoke(IpcChannel.removeRoot, { id }),
  rescan: (id) => ipcRenderer.invoke(IpcChannel.rescan, { id }),
  queryAssets: (query) => ipcRenderer.invoke(IpcChannel.queryAssets, query),
  getAsset: (id) => ipcRenderer.invoke(IpcChannel.getAsset, { id }),
  setFavorite: (id, favorite) => ipcRenderer.invoke(IpcChannel.setFavorite, { id, favorite }),
  addTag: (id, name) => ipcRenderer.invoke(IpcChannel.addTag, { id, name }),
  removeTag: (id, name) => ipcRenderer.invoke(IpcChannel.removeTag, { id, name }),
  revealAsset: (id) => ipcRenderer.invoke(IpcChannel.revealAsset, { id }),
  listTags: () => ipcRenderer.invoke(IpcChannel.listTags),
  getCounts: () => ipcRenderer.invoke(IpcChannel.getCounts),
  getHosts: () => ipcRenderer.invoke(IpcChannel.getHosts),
  sendToAfterEffects: (id, addToComp) =>
    ipcRenderer.invoke(IpcChannel.sendToAfterEffects, { id, addToComp }),
  onLibraryEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: LibraryEvent): void => listener(payload)
    ipcRenderer.on(LIBRARY_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(LIBRARY_EVENT_CHANNEL, handler)
  },
  pickDragTestFiles: () => ipcRenderer.invoke(IpcChannel.pickDragTestFiles),
  startDrag: (ids) => ipcRenderer.send(IpcChannel.startDrag, { ids })
}

contextBridge.exposeInMainWorld('assetLibrary', api)

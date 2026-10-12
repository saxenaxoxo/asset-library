import type { IpcResponse, LibraryEvent } from './schemas'
import type { IpcChannel } from './channels'
import type {
  AssetPage,
  AssetQuery,
  AssetRecord,
  LibraryCounts,
  RootRecord,
  TagCount
} from './library'

export type AppInfo = IpcResponse<typeof IpcChannel.getAppInfo>
export type Diagnostics = IpcResponse<typeof IpcChannel.getDiagnostics>
export type Hosts = IpcResponse<typeof IpcChannel.getHosts>
export type HostResult = IpcResponse<typeof IpcChannel.sendToAfterEffects>
export type DragItem = IpcResponse<typeof IpcChannel.pickDragTestFiles>[number]
export type {
  AssetPage,
  AssetQuery,
  AssetRecord,
  LibraryCounts,
  LibraryEvent,
  RootRecord,
  TagCount
}

/** The only surface the renderer can reach. Exposed as `window.assetLibrary` by the preload. */
export interface AssetLibraryApi {
  getAppInfo(): Promise<AppInfo>
  /** Versions and capabilities of bundled components, for the About screen and support. */
  getDiagnostics(): Promise<Diagnostics>

  listRoots(): Promise<RootRecord[]>
  /** Opens the folder picker and adds the chosen folder. Resolves to null when cancelled. */
  addFolder(): Promise<RootRecord | null>
  /** Forgets a folder and its index. The files themselves are never touched. */
  removeRoot(id: number): Promise<void>
  /** Rescans one folder, or all of them when no ID is given. */
  rescan(id?: number): Promise<void>

  queryAssets(query: AssetQuery): Promise<AssetPage>
  getAsset(id: string): Promise<AssetRecord | null>
  setFavorite(id: string, favorite: boolean): Promise<void>
  addTag(id: string, name: string): Promise<void>
  removeTag(id: string, name: string): Promise<void>
  /** Shows the file in Finder/Explorer. Resolves to false if it can't be found. */
  revealAsset(id: string): Promise<boolean>
  listTags(): Promise<TagCount[]>
  getCounts(): Promise<LibraryCounts>

  /** Which editing apps can receive assets directly. */
  getHosts(): Promise<Hosts>
  /** Imports the asset into the open After Effects project (optionally into the active comp). */
  sendToAfterEffects(id: string, addToComp: boolean): Promise<HostResult>

  /** Subscribes to scan progress and change notifications. Returns an unsubscribe function. */
  onLibraryEvent(listener: (event: LibraryEvent) => void): () => void

  /** Temporary drag-out test: pick arbitrary files to drag into other apps. */
  pickDragTestFiles(): Promise<DragItem[]>
  /** Starts a native OS drag of the given assets (originals). Call from a dragstart handler. */
  startDrag(ids: string[]): void
}

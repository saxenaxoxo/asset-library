import type { IpcResponse } from './schemas'
import type { IpcChannel } from './channels'

export type AppInfo = IpcResponse<typeof IpcChannel.getAppInfo>
export type Diagnostics = IpcResponse<typeof IpcChannel.getDiagnostics>
export type PickedFolder = IpcResponse<typeof IpcChannel.pickFolder>
export type DragItem = IpcResponse<typeof IpcChannel.pickDragTestFiles>[number]

/** The only surface the renderer can reach. Exposed as `window.assetLibrary` by the preload. */
export interface AssetLibraryApi {
  getAppInfo(): Promise<AppInfo>
  /** Versions and capabilities of bundled components, for the About screen and support. */
  getDiagnostics(): Promise<Diagnostics>
  /** Opens the OS folder picker. Resolves to null when the user cancels. */
  pickFolder(): Promise<PickedFolder>
  /** Temporary (M2 drag-out spike): pick files to test dragging into other apps. */
  pickDragTestFiles(): Promise<DragItem[]>
  /** Starts a native OS drag of the given items. Call from a dragstart handler. */
  startDrag(ids: string[]): void
}

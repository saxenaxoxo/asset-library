/**
 * IPC channel names. Dependency-free so the sandboxed preload can import it.
 * Every request channel needs zod schemas in ./schemas.ts and a handler in src/main/ipc.
 */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
  getDiagnostics: 'app:get-diagnostics',
  listRoots: 'roots:list',
  addFolder: 'roots:add-folder',
  removeRoot: 'roots:remove',
  rescan: 'roots:rescan',
  queryAssets: 'assets:query',
  getAsset: 'assets:get',
  setFavorite: 'assets:set-favorite',
  addTag: 'assets:add-tag',
  removeTag: 'assets:remove-tag',
  revealAsset: 'assets:reveal',
  listTags: 'tags:list',
  getCounts: 'library:counts',
  getHosts: 'hosts:get',
  sendToAfterEffects: 'hosts:send-to-after-effects',
  pickDragTestFiles: 'drag:pick-test-files',
  /** Fire-and-forget (ipcRenderer.send): must start during the renderer's dragstart. */
  startDrag: 'drag:start'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/** Main → renderer push channel for library events (scan progress, data changed). */
export const LIBRARY_EVENT_CHANNEL = 'library:event'

/**
 * IPC channel names. Dependency-free so the sandboxed preload can import it.
 * Every channel here must have a zod schema in ./schemas.ts and a handler in src/main/ipc.
 */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
  getDiagnostics: 'app:get-diagnostics',
  pickFolder: 'library:pick-folder',
  pickDragTestFiles: 'drag:pick-test-files',
  /** Fire-and-forget (ipcRenderer.send): must start during the renderer's dragstart. */
  startDrag: 'drag:start'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

import { z } from 'zod'
import { IpcChannel, type IpcChannelName } from './channels'

export const AppInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.enum(['darwin', 'win32', 'linux'])
})

export const DiagnosticsSchema = z.object({
  sqliteVersion: z.string(),
  fts5: z.boolean(),
  /** null when the bundled FFprobe is missing or failed to run. */
  ffprobeVersion: z.string().nullable()
})

export const PickedFolderSchema = z.object({ path: z.string().min(1) }).nullable()

export const DragItemSchema = z.object({ id: z.uuid(), name: z.string().min(1) })
export const DragItemsSchema = z.array(DragItemSchema)
export const StartDragSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) })

/** Request and response schemas for each channel. Main validates both directions. */
export const ipcContract = {
  [IpcChannel.getAppInfo]: { request: z.undefined(), response: AppInfoSchema },
  [IpcChannel.getDiagnostics]: { request: z.undefined(), response: DiagnosticsSchema },
  [IpcChannel.pickFolder]: { request: z.undefined(), response: PickedFolderSchema },
  [IpcChannel.pickDragTestFiles]: { request: z.undefined(), response: DragItemsSchema },
  [IpcChannel.startDrag]: { request: StartDragSchema, response: z.void() }
} satisfies Record<IpcChannelName, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcRequest<C extends IpcChannelName> = z.infer<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannelName> = z.infer<IpcContract[C]['response']>

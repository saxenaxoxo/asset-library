import { z } from 'zod'
import { IpcChannel, type IpcChannelName } from './channels'
import {
  AssetPageSchema,
  AssetQuerySchema,
  AssetRecordSchema,
  LibraryCountsSchema,
  RootRecordSchema,
  ScanProgressSchema,
  TagCountSchema
} from './library'

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

const AssetIdSchema = z.object({ id: z.uuid() })
const TagEditSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(60) })

export const DragItemSchema = z.object({ id: z.uuid(), name: z.string().min(1) })
export const StartDragSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) })

export const LibraryEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scan-progress'), progress: ScanProgressSchema }),
  z.object({ type: z.literal('library-changed') })
])

/** Request and response schemas for each channel. Main validates both directions. */
export const ipcContract = {
  [IpcChannel.getAppInfo]: { request: z.undefined(), response: AppInfoSchema },
  [IpcChannel.getDiagnostics]: { request: z.undefined(), response: DiagnosticsSchema },
  [IpcChannel.listRoots]: { request: z.undefined(), response: z.array(RootRecordSchema) },
  [IpcChannel.addFolder]: { request: z.undefined(), response: RootRecordSchema.nullable() },
  [IpcChannel.removeRoot]: { request: z.object({ id: z.number().int() }), response: z.void() },
  [IpcChannel.rescan]: {
    request: z.object({ id: z.number().int().optional() }),
    response: z.void()
  },
  [IpcChannel.queryAssets]: { request: AssetQuerySchema, response: AssetPageSchema },
  [IpcChannel.getAsset]: { request: AssetIdSchema, response: AssetRecordSchema.nullable() },
  [IpcChannel.setFavorite]: {
    request: z.object({ id: z.uuid(), favorite: z.boolean() }),
    response: z.void()
  },
  [IpcChannel.addTag]: { request: TagEditSchema, response: z.void() },
  [IpcChannel.removeTag]: { request: TagEditSchema, response: z.void() },
  [IpcChannel.revealAsset]: { request: AssetIdSchema, response: z.boolean() },
  [IpcChannel.listTags]: { request: z.undefined(), response: z.array(TagCountSchema) },
  [IpcChannel.getCounts]: { request: z.undefined(), response: LibraryCountsSchema },
  [IpcChannel.pickDragTestFiles]: { request: z.undefined(), response: z.array(DragItemSchema) },
  [IpcChannel.startDrag]: { request: StartDragSchema, response: z.void() }
} satisfies Record<IpcChannelName, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcRequest<C extends IpcChannelName> = z.infer<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannelName> = z.infer<IpcContract[C]['response']>
export type LibraryEvent = z.infer<typeof LibraryEventSchema>

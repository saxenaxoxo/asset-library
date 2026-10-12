import { z } from 'zod'

export const AssetKindSchema = z.enum(['video', 'audio', 'image', 'template'])
export const AssetSortSchema = z.enum(['added', 'name', 'modified', 'size', 'duration'])

export const AssetRecordSchema = z.object({
  id: z.string(),
  rootId: z.number().int(),
  relPath: z.string(),
  filename: z.string(),
  ext: z.string(),
  kind: AssetKindSchema,
  size: z.number(),
  mtime: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  fps: z.number().nullable(),
  codec: z.string().nullable(),
  hasAlpha: z.boolean().nullable(),
  channels: z.number().nullable(),
  sampleRate: z.number().nullable(),
  probeState: z.enum(['pending', 'done', 'error']),
  /** "offline" = the asset's drive or folder is currently unavailable. */
  status: z.enum(['ok', 'missing', 'error', 'offline']),
  errorMessage: z.string().nullable(),
  favorite: z.boolean(),
  notes: z.string().nullable(),
  addedAt: z.number(),
  tags: z.array(z.string()),
  /** Generated previews. `key` changes whenever the file changes (cache-busting). */
  media: z.object({
    state: z.enum(['pending', 'done', 'error']),
    key: z.string().nullable(),
    thumb: z.boolean(),
    sprite: z.boolean(),
    preview: z.boolean(),
    wave: z.boolean()
  })
})

export const RootRecordSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'offline']),
  addedAt: z.number(),
  lastScanAt: z.number().nullable(),
  assetCount: z.number().int(),
  scanning: z.boolean()
})

export const AssetQuerySchema = z.object({
  text: z.string().max(200).optional(),
  kind: AssetKindSchema.optional(),
  rootId: z.number().int().optional(),
  tag: z.string().max(100).optional(),
  favoritesOnly: z.boolean().optional(),
  recentOnly: z.boolean().optional(),
  missingOnly: z.boolean().optional(),
  includeMissing: z.boolean().optional(),
  sort: AssetSortSchema.optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional()
})

export const AssetPageSchema = z.object({
  total: z.number().int(),
  items: z.array(AssetRecordSchema)
})

export const LibraryCountsSchema = z.object({
  total: z.number().int(),
  video: z.number().int(),
  audio: z.number().int(),
  image: z.number().int(),
  template: z.number().int(),
  favorites: z.number().int(),
  missing: z.number().int()
})

export const TagCountSchema = z.object({ name: z.string(), count: z.number().int() })

export const ScanProgressSchema = z.object({
  rootId: z.number().int(),
  state: z.enum(['scanning', 'done', 'offline', 'failed']),
  filesSeen: z.number().int(),
  added: z.number().int().optional(),
  moved: z.number().int().optional(),
  missing: z.number().int().optional(),
  message: z.string().optional()
})

export type AssetKind = z.infer<typeof AssetKindSchema>
export type AssetSort = z.infer<typeof AssetSortSchema>
export type AssetRecord = z.infer<typeof AssetRecordSchema>
export type RootRecord = z.infer<typeof RootRecordSchema>
export type AssetQuery = z.infer<typeof AssetQuerySchema>
export type AssetPage = z.infer<typeof AssetPageSchema>
export type LibraryCounts = z.infer<typeof LibraryCountsSchema>
export type TagCount = z.infer<typeof TagCountSchema>
export type ScanProgress = z.infer<typeof ScanProgressSchema>

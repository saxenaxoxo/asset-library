import { z } from 'zod'
import { IpcChannel, type IpcChannelName } from './channels'

export const DiagnosticsSchema = z.object({
  sqliteVersion: z.string(),
  fts5: z.boolean(),
  /** null when the bundled FFprobe is missing or failed to run. */
  ffprobeVersion: z.string().nullable()
})

const PanelBuildSchema = z.enum(['cep', 'uxp'])

/** Where a build would come from now: a newer verified download, or the copy in the Hub. */
const PanelSourceSchema = z.object({
  version: z.string(),
  from: z.enum(['download', 'bundled']),
  /** Download size in bytes; null for the built-in copy. */
  size: z.number().int().nonnegative().nullable()
})

export const InstallerStatusSchema = z.object({
  appVersion: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  /** False in development: no panel is bundled and nothing can be installed. */
  packaged: z.boolean(),
  /** Adobe's plug-in installer (part of Creative Cloud) was found. */
  adobeInstaller: z.boolean(),
  /** Each Premiere Pro version Adobe's installer reports, with the panel versions it lists. */
  premiere: z.array(
    z.object({ version: z.string(), cep: z.array(z.string()), uxp: z.array(z.string()) })
  ),
  /** The panel versions this copy of the app carries. */
  bundled: z.object({ cep: z.string().nullable(), uxp: z.string().nullable() }),
  /** What Install would put in place for each build, or null when no copy is available. */
  available: z.object({ cep: PanelSourceSchema.nullable(), uxp: PanelSourceSchema.nullable() }),
  /** The panel download list: read, unreachable (offline), unusable, or not asked for yet. */
  catalog: z.object({
    state: z.enum(['ok', 'offline', 'invalid', 'not-checked']),
    message: z.string().nullable()
  }),
  /** Products in the download list this Hub can't install yet (it needs updating first). */
  otherProducts: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Only folders that exist on this computer. */
  locations: z.object({
    premiereApps: z.array(z.string()),
    cepExtensions: z.array(z.string()),
    data: z.string(),
    cache: z.string()
  })
})

export const InstallerResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Why a download-and-install didn't finish, when it was the download. */
  code: z.enum(['offline', 'server', 'verification', 'cancelled']).optional()
})

/** A download or install in progress; byte counts are the real ones from the network. */
export const InstallProgressSchema = z
  .object({
    phase: z.enum(['downloading', 'verifying', 'installing']),
    build: PanelBuildSchema.nullable(),
    version: z.string().nullable(),
    received: z.number().nonnegative(),
    total: z.number().nonnegative()
  })
  .nullable()

export const RevealTargetSchema = z.object({
  target: z.enum(['premiere-app', 'cep-extension', 'data', 'cache']),
  index: z.number().int().min(0).max(20).default(0)
})

export const LinkSchema = z.object({
  link: z.enum(['repository', 'issues', 'license', 'panel-guide'])
})

/** The background engine, as the window shows it. */
export const EngineStateSchema = z.object({
  /** The engine runs in this process, so while the window can ask, it's running. */
  running: z.literal(true),
  /** What it's doing, e.g. "Up to date" or "Indexing 1,200 files…". */
  line: z.string().max(200),
  startAtLogin: z.boolean()
})

/** Request and response schemas for each channel. Main validates both directions. */
export const ipcContract = {
  [IpcChannel.getDiagnostics]: { request: z.undefined(), response: DiagnosticsSchema },
  [IpcChannel.getInstallerStatus]: {
    /** `refresh` reads the download list again instead of using the last five minutes' copy. */
    request: z.object({ refresh: z.boolean().optional() }).optional(),
    response: InstallerStatusSchema
  },
  [IpcChannel.installPanel]: {
    request: z.object({ builds: z.array(PanelBuildSchema).max(2).optional() }),
    response: InstallerResultSchema
  },
  [IpcChannel.getInstallProgress]: { request: z.undefined(), response: InstallProgressSchema },
  [IpcChannel.cancelDownload]: { request: z.undefined(), response: z.boolean() },
  [IpcChannel.removePanel]: {
    request: z.object({ build: PanelBuildSchema }),
    response: InstallerResultSchema
  },
  [IpcChannel.uninstallApp]: { request: z.undefined(), response: z.void() },
  [IpcChannel.revealLocation]: { request: RevealTargetSchema, response: z.boolean() },
  [IpcChannel.openLink]: { request: LinkSchema, response: z.boolean() },
  [IpcChannel.getEngineState]: { request: z.undefined(), response: EngineStateSchema },
  [IpcChannel.setStartAtLogin]: {
    request: z.object({ enabled: z.boolean() }),
    response: EngineStateSchema
  }
} satisfies Record<IpcChannelName, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcRequest<C extends IpcChannelName> = z.infer<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannelName> = z.infer<IpcContract[C]['response']>

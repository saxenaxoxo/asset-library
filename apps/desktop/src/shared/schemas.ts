import { z } from 'zod'
import { IpcChannel, type IpcChannelName } from './channels'

export const DiagnosticsSchema = z.object({
  sqliteVersion: z.string(),
  fts5: z.boolean(),
  /** null when the bundled FFprobe is missing or failed to run. */
  ffprobeVersion: z.string().nullable()
})

const PanelBuildSchema = z.enum(['cep', 'uxp'])

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
  /** Only folders that exist on this computer. */
  locations: z.object({
    premiereApps: z.array(z.string()),
    cepExtensions: z.array(z.string()),
    data: z.string(),
    cache: z.string()
  })
})

export const InstallerResultSchema = z.object({ ok: z.boolean(), message: z.string() })

export const RevealTargetSchema = z.object({
  target: z.enum(['premiere-app', 'cep-extension', 'data', 'cache']),
  index: z.number().int().min(0).max(20).default(0)
})

export const LinkSchema = z.object({
  link: z.enum(['repository', 'issues', 'license', 'panel-guide'])
})

/** Request and response schemas for each channel. Main validates both directions. */
export const ipcContract = {
  [IpcChannel.getDiagnostics]: { request: z.undefined(), response: DiagnosticsSchema },
  [IpcChannel.getInstallerStatus]: { request: z.undefined(), response: InstallerStatusSchema },
  [IpcChannel.installPanel]: {
    request: z.object({ builds: z.array(PanelBuildSchema).max(2).optional() }),
    response: InstallerResultSchema
  },
  [IpcChannel.removePanel]: {
    request: z.object({ build: PanelBuildSchema }),
    response: InstallerResultSchema
  },
  [IpcChannel.uninstallApp]: { request: z.undefined(), response: z.void() },
  [IpcChannel.revealLocation]: { request: RevealTargetSchema, response: z.boolean() },
  [IpcChannel.openLink]: { request: LinkSchema, response: z.boolean() }
} satisfies Record<IpcChannelName, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcRequest<C extends IpcChannelName> = z.infer<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannelName> = z.infer<IpcContract[C]['response']>

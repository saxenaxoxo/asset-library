// Everything that talks to Premiere Pro from the CEP runtime: ExtendScript in cep/host.jsx,
// called through the bridge. Each call answers with JSON {ok, message}.
import type { CatalogAsset } from '@catalog/types'
import { UserError, type InsertOptions } from '../placing'
import { bridge } from './platform'

export { UserError, type InsertOptions }

interface Reply {
  ok: boolean
  message: string
}

/**
 * A value as an ExtendScript literal. JSON is one, except that ExtendScript ends a string at
 * U+2028/U+2029 and has trouble with non-ASCII in scripts, so every such character is written
 * as \uXXXX. File names from a downloaded pack can never turn into code this way.
 */
export function literal(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/** Runs one of the `AL` functions in host.jsx with these arguments. */
async function call(fn: 'place' | 'placeMany' | 'importOnly', ...args: unknown[]): Promise<Reply> {
  const api = bridge()
  if (!api) throw new UserError('This panel needs to run inside Premiere Pro.')
  const script = `AL.${fn}(${args.map(literal).join(',')})`
  const text = await new Promise<string>((resolve) => api.evalScript(script, resolve))
  if (text === 'EvalScript error.')
    throw new Error("Premiere couldn't run the panel's script. Reopen the panel and try again.")
  let reply: Reply
  try {
    reply = JSON.parse(text) as Reply
  } catch {
    throw new Error(`Unexpected reply from Premiere: ${text.slice(0, 120)}`)
  }
  if (!reply.ok) throw new UserError(reply.message)
  return reply
}

function isMogrt(asset: CatalogAsset): boolean {
  return asset.name.toLowerCase().endsWith('.mogrt')
}

/** Imports (if needed) and places the asset at the playhead of the active sequence. */
export async function insertAtPlayhead(
  asset: CatalogAsset,
  options: InsertOptions
): Promise<string> {
  const reply = await call(
    'place',
    asset.path,
    asset.name,
    options.mode,
    options.videoTrack,
    options.audioTrack,
    isMogrt(asset),
    asset.kind
  )
  return reply.message
}

/** Places several assets one after another from the playhead. */
export async function placeAtPlayhead(
  assets: CatalogAsset[],
  options: InsertOptions
): Promise<string> {
  if (assets.length === 1) return insertAtPlayhead(assets[0] as CatalogAsset, options)
  const reply = await call(
    'placeMany',
    assets.map((asset) => ({
      path: asset.path,
      name: asset.name,
      kind: asset.kind,
      mogrt: isMogrt(asset)
    })),
    options.mode,
    options.videoTrack,
    options.audioTrack
  )
  return reply.message
}

/** Imports into the project without touching the timeline. */
export async function importOnly(asset: CatalogAsset): Promise<string> {
  if (asset.kind === 'template' && !isMogrt(asset))
    throw new UserError(`${asset.name} can't be imported into Premiere Pro.`)
  return (await call('importOnly', asset.path, asset.name)).message
}

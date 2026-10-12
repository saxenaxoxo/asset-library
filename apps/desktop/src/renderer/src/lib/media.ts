import type { AssetRecord } from '@shared/library'

export type MediaKind = 'thumb' | 'sprite' | 'preview' | 'wave' | 'original'

/** URL of an asset's generated media, served by the app's asset:// protocol (by ID only). */
export function mediaUrl(asset: AssetRecord, kind: MediaKind): string {
  return `asset://${kind}/${asset.id}?v=${asset.media.key ?? '0'}`
}

/** Sprite strips hold this many frames side by side (matches the media plan). */
export const SPRITE_FRAMES = 10

import { AudioLines, Film, Image, Layers, Star, Unplug, SearchX } from 'lucide-react'
import type { AssetRecord } from '@shared/library'
import { formatDuration } from '../lib/format'

const KIND_ICON = { video: Film, audio: AudioLines, image: Image, template: Layers } as const

/**
 * The visual part of a tile. Shows a kind placeholder until real thumbnails arrive (M5);
 * transparent assets sit on a checkerboard so overlays read as overlays.
 */
export function AssetThumb({
  asset,
  large = false
}: {
  asset: AssetRecord
  large?: boolean
}): React.JSX.Element {
  const Icon = KIND_ICON[asset.kind]
  const duration = formatDuration(asset.durationMs)
  const unavailable = asset.status === 'offline' || asset.status === 'missing'

  return (
    <div
      className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md ${
        asset.hasAlpha ? 'checkerboard' : 'bg-raised'
      }`}
    >
      <Icon
        size={large ? 40 : 26}
        strokeWidth={1.5}
        className={unavailable ? 'text-ink-3/50' : 'text-ink-3'}
        aria-hidden="true"
      />

      <span className="absolute bottom-1.5 left-1.5 rounded bg-canvas/80 px-1.5 py-0.5 text-2xs font-medium text-ink-2 uppercase">
        {asset.ext}
      </span>
      {duration && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-canvas/80 px-1.5 py-0.5 text-2xs text-ink-2">
          {duration}
        </span>
      )}
      {asset.hasAlpha && (
        <span className="absolute top-1.5 left-1.5 rounded bg-brand-surface/90 px-1.5 py-0.5 text-2xs font-medium text-brand-200">
          Alpha
        </span>
      )}
      {asset.favorite && (
        <Star
          size={14}
          className="absolute top-1.5 right-1.5 fill-brand-400 text-brand-400"
          aria-label="Favorite"
        />
      )}
      {unavailable && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-canvas/70 text-xs text-ink-2">
          {asset.status === 'offline' ? <Unplug size={14} /> : <SearchX size={14} />}
          {asset.status === 'offline' ? 'Drive offline' : 'File missing'}
        </div>
      )}
    </div>
  )
}

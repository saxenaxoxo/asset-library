import { useState } from 'react'
import { AudioLines, Film, Image, Layers, SearchX, Star, Unplug } from 'lucide-react'
import type { AssetRecord } from '@shared/library'
import { formatDuration } from '../lib/format'
import { mediaUrl, SPRITE_FRAMES } from '../lib/media'

const KIND_ICON = { video: Film, audio: AudioLines, image: Image, template: Layers } as const

/**
 * The visual part of a tile: generated thumbnail (or waveform for audio), hover-scrub through
 * the sprite strip for video, and a kind placeholder while media is still being generated.
 * Transparent assets sit on a checkerboard so overlays read as overlays.
 */
export function AssetThumb({
  asset,
  large = false,
  scrub = true
}: {
  asset: AssetRecord
  large?: boolean
  scrub?: boolean
}): React.JSX.Element {
  const Icon = KIND_ICON[asset.kind]
  const duration = formatDuration(asset.durationMs)
  const unavailable = asset.status === 'offline' || asset.status === 'missing'
  const [frame, setFrame] = useState<number | null>(null)
  const [broken, setBroken] = useState(false)

  const still =
    asset.kind === 'audio'
      ? asset.media.wave
        ? mediaUrl(asset, 'wave')
        : null
      : asset.media.thumb
        ? mediaUrl(asset, 'thumb')
        : null
  const canScrub = scrub && asset.kind === 'video' && asset.media.sprite && !unavailable

  function onMove(event: React.MouseEvent<HTMLDivElement>): void {
    if (!canScrub) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width))
    setFrame(Math.floor(ratio * SPRITE_FRAMES))
  }

  return (
    <div
      onMouseMove={onMove}
      onMouseLeave={() => setFrame(null)}
      className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md ${
        asset.hasAlpha ? 'checkerboard' : 'bg-raised'
      }`}
    >
      {still && !broken ? (
        <img
          src={still}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`h-full w-full ${asset.kind === 'audio' ? 'object-fill px-3 py-6' : 'object-contain'} ${
            unavailable ? 'opacity-40' : ''
          }`}
        />
      ) : (
        <Icon
          size={large ? 40 : 26}
          strokeWidth={1.5}
          className={unavailable ? 'text-ink-3/50' : 'text-ink-3'}
          aria-hidden="true"
        />
      )}

      {canScrub && frame !== null && (
        <>
          <div
            className="absolute inset-0 bg-no-repeat"
            style={{
              backgroundImage: `url("${mediaUrl(asset, 'sprite')}")`,
              backgroundSize: `${SPRITE_FRAMES * 100}% 100%`,
              backgroundPosition: `${(frame * 100) / (SPRITE_FRAMES - 1)}% 0`
            }}
            aria-hidden="true"
          />
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-brand-400"
            style={{ width: `${((frame + 1) / SPRITE_FRAMES) * 100}%` }}
            aria-hidden="true"
          />
        </>
      )}

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

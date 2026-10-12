import type { AssetRecord } from '@shared/library'
import { mediaUrl } from '../lib/media'
import { AssetThumb } from './AssetThumb'

/** Large preview in the details panel: plays video and audio, shows stills. */
export function AssetPreview({ asset }: { asset: AssetRecord }): React.JSX.Element {
  const available = asset.status === 'ok'

  if (available && asset.kind === 'video' && asset.media.preview) {
    return (
      <div
        className={`overflow-hidden rounded-md ${asset.hasAlpha ? 'checkerboard' : 'bg-raised'}`}
      >
        <video
          key={asset.id}
          src={mediaUrl(asset, 'preview')}
          poster={asset.media.thumb ? mediaUrl(asset, 'thumb') : undefined}
          className="aspect-video w-full"
          controls
          loop
          muted
          autoPlay
          playsInline
        />
      </div>
    )
  }

  if (available && asset.kind === 'audio') {
    return (
      <div className="space-y-2">
        <AssetThumb asset={asset} large scrub={false} />
        <audio
          key={asset.id}
          src={mediaUrl(asset, asset.media.preview ? 'preview' : 'original')}
          controls
          className="h-9 w-full"
        />
      </div>
    )
  }

  return <AssetThumb asset={asset} large />
}

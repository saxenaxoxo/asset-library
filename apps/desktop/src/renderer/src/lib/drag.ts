import type { AssetRecord } from '@shared/library'

/** Hands a drag to the OS so the original file lands in Premiere, After Effects or any app. */
export function startAssetDrag(event: React.DragEvent, asset: AssetRecord): void {
  event.preventDefault()
  if (asset.status === 'ok' || asset.status === 'error') window.assetLibrary.startDrag([asset.id])
}

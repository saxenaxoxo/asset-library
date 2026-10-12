import type { AssetRecord } from '@shared/library'

/** 4004 → "0:04", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Common resolution names for video, otherwise plain dimensions. */
export function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const vertical = height > width
  const named =
    short >= 2160 && long >= 3840
      ? '4K'
      : short === 1440
        ? '1440p'
        : short === 1080
          ? '1080p'
          : short === 720
            ? '720p'
            : null
  if (named) return vertical ? `${named} vertical` : named
  return `${width}×${height}`
}

/** One short line under a tile: the details an editor scans for first. */
export function assetSummary(asset: AssetRecord): string {
  const parts: string[] = []
  if (asset.kind === 'video') {
    const res = formatResolution(asset.width, asset.height)
    if (res) parts.push(res)
    const dur = formatDuration(asset.durationMs)
    if (dur) parts.push(dur)
  } else if (asset.kind === 'audio') {
    const dur = formatDuration(asset.durationMs)
    if (dur) parts.push(dur)
    if (asset.channels)
      parts.push(
        asset.channels === 1 ? 'Mono' : asset.channels === 2 ? 'Stereo' : `${asset.channels} ch`
      )
  } else if (asset.kind === 'image') {
    const res = formatResolution(asset.width, asset.height)
    if (res) parts.push(res)
  }
  if (parts.length === 0) parts.push(asset.ext.toUpperCase())
  return parts.join(', ')
}

import type { CatalogAsset, CatalogKind } from './types'

export interface CatalogFilter {
  text?: string
  kind?: CatalogKind | 'all'
  favoritesOnly?: boolean
  tag?: string
  sort?: 'added' | 'name' | 'duration'
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD')
}

/**
 * Filters and sorts catalog assets in memory. Every word must appear somewhere in the name,
 * folder, root or tags, so "glitch trans" finds "Glitch Transitions/Glitch 04.mov".
 */
export function filterAssets(
  assets: readonly CatalogAsset[],
  filter: CatalogFilter
): CatalogAsset[] {
  const words = normalize(filter.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const result = assets.filter((asset) => {
    if (filter.kind && filter.kind !== 'all' && asset.kind !== filter.kind) return false
    if (filter.favoritesOnly && !asset.favorite) return false
    if (filter.tag && !asset.tags.includes(filter.tag)) return false
    if (words.length === 0) return true
    const haystack = normalize(
      `${asset.name} ${asset.folder} ${asset.root} ${asset.tags.join(' ')}`
    )
    return words.every((word) => haystack.includes(word))
  })
  const sort = filter.sort ?? 'added'
  return result.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true })
    if (sort === 'duration') return (b.durationMs ?? -1) - (a.durationMs ?? -1)
    return b.addedAt - a.addedAt
  })
}

/** 4004 → "0:04", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AudioLines, Film, Image, Layers, Star } from 'lucide-react'
import type { AssetRecord } from '@shared/library'
import type { AssetPages } from '../hooks/useAssetPages'
import { formatBytes, formatDuration, formatResolution } from '../lib/format'
import { startAssetDrag } from '../lib/drag'

const ROW_HEIGHT = 36
const KIND_ICON = { video: Film, audio: AudioLines, image: Image, template: Layers } as const
const COLUMNS = 'minmax(0,1fr) 92px 110px 84px 220px'

interface AssetListProps {
  pages: AssetPages
  selectedId: string | null
  onSelect: (asset: AssetRecord, index: number) => void
  onOpen: (asset: AssetRecord) => void
  scrollToIndex: number | null
}

function folderOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash === -1 ? '' : relPath.slice(0, slash)
}

export function AssetList({
  pages,
  selectedId,
  onSelect,
  onOpen,
  scrollToIndex
}: AssetListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: pages.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })
  const items = virtualizer.getVirtualItems()
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? 0
  const { ensureRange } = pages
  useEffect(() => ensureRange(first, last), [first, last, ensureRange, pages.total])
  useEffect(() => {
    if (scrollToIndex !== null) virtualizer.scrollToIndex(scrollToIndex)
  }, [scrollToIndex, virtualizer])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid shrink-0 gap-3 border-b border-line px-5 py-2 text-2xs font-medium text-ink-3"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Name</span>
        <span>Duration</span>
        <span>Size</span>
        <span>File size</span>
        <span>Folder</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto" role="listbox" aria-label="Assets">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const asset = pages.itemAt(item.index)
            const style = { top: item.start, height: ROW_HEIGHT, gridTemplateColumns: COLUMNS }
            if (!asset) {
              return (
                <div key={item.key} className="absolute inset-x-0 px-5" style={style}>
                  <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-raised" />
                </div>
              )
            }
            const Icon = KIND_ICON[asset.kind]
            const selected = asset.id === selectedId
            const unavailable = asset.status === 'offline' || asset.status === 'missing'
            return (
              <div
                key={asset.id}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                draggable
                onDragStart={(event) => startAssetDrag(event, asset)}
                onClick={() => onSelect(asset, item.index)}
                onDoubleClick={() => onOpen(asset)}
                className={`absolute inset-x-0 grid cursor-default items-center gap-3 px-5 text-sm ${
                  selected ? 'bg-brand-surface' : 'hover:bg-raised/60'
                } ${unavailable ? 'text-ink-3' : 'text-ink'}`}
                style={style}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
                  <span className="truncate">{asset.filename}</span>
                  {asset.favorite && (
                    <Star size={12} className="shrink-0 fill-brand-400 text-brand-400" />
                  )}
                  {asset.hasAlpha && (
                    <span className="shrink-0 text-2xs text-brand-300">Alpha</span>
                  )}
                </span>
                <span className="text-ink-2">{formatDuration(asset.durationMs) ?? '—'}</span>
                <span className="text-ink-2">
                  {formatResolution(asset.width, asset.height) ?? '—'}
                </span>
                <span className="text-ink-2">{formatBytes(asset.size)}</span>
                <span className="truncate text-ink-3" title={folderOf(asset.relPath)}>
                  {folderOf(asset.relPath) || '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

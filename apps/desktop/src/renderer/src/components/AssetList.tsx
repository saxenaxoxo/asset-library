import { memo, useEffect, useImperativeHandle, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AudioLines, Film, Image, Layers, Star } from 'lucide-react'
import type { AssetRecord } from '@shared/library'
import type { AssetPages } from '../hooks/useAssetPages'
import type { AssetViewHandle } from '../types'
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
  ref?: React.Ref<AssetViewHandle>
}

interface AssetRowProps {
  asset: AssetRecord
  index: number
  top: number
  selected: boolean
  onSelect: (asset: AssetRecord, index: number) => void
  onOpen: (asset: AssetRecord) => void
}

function folderOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash === -1 ? '' : relPath.slice(0, slash)
}

function optionId(id: string): string {
  return `asset-option-${id}`
}

function AssetRowView({
  asset,
  index,
  top,
  selected,
  onSelect,
  onOpen
}: AssetRowProps): React.JSX.Element {
  const Icon = KIND_ICON[asset.kind]
  const unavailable = asset.status === 'offline' || asset.status === 'missing'
  const folder = folderOf(asset.relPath)
  return (
    <div
      id={optionId(asset.id)}
      role="option"
      aria-selected={selected}
      draggable
      onDragStart={(event) => startAssetDrag(event, asset)}
      onClick={() => onSelect(asset, index)}
      onDoubleClick={() => onOpen(asset)}
      className={`absolute inset-x-0 grid cursor-default items-center gap-3 px-5 text-sm ${
        selected ? 'bg-brand-surface' : 'hover:bg-raised/60'
      } ${unavailable ? 'text-ink-3' : 'text-ink'}`}
      style={{ top, height: ROW_HEIGHT, gridTemplateColumns: COLUMNS }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
        <span className="truncate">{asset.filename}</span>
        {asset.favorite && <Star size={12} className="shrink-0 fill-brand-400 text-brand-400" />}
        {asset.hasAlpha && <span className="shrink-0 text-2xs text-brand-300">Alpha</span>}
      </span>
      <span className="text-ink-2">{formatDuration(asset.durationMs) ?? '—'}</span>
      <span className="text-ink-2">{formatResolution(asset.width, asset.height) ?? '—'}</span>
      <span className="text-ink-2">{formatBytes(asset.size)}</span>
      <span className="truncate text-ink-3" title={folder}>
        {folder || '—'}
      </span>
    </div>
  )
}

const AssetRow = memo(AssetRowView)

function AssetListView({
  pages,
  selectedId,
  onSelect,
  onOpen,
  ref
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

  useImperativeHandle(
    ref,
    () => ({ columns: 1, scrollToIndex: (index: number) => virtualizer.scrollToIndex(index) }),
    [virtualizer]
  )

  // The listbox holds focus; the selected row is announced as its active option when rendered.
  const activeDescendant =
    selectedId !== null && items.some((item) => pages.itemAt(item.index)?.id === selectedId)
      ? optionId(selectedId)
      : undefined

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
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset"
        role="listbox"
        aria-label="Assets"
        tabIndex={0}
        aria-activedescendant={activeDescendant}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const asset = pages.itemAt(item.index)
            if (!asset) {
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 px-5"
                  style={{ top: item.start, height: ROW_HEIGHT }}
                >
                  <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-raised" />
                </div>
              )
            }
            return (
              <AssetRow
                key={asset.id}
                asset={asset}
                index={item.index}
                top={item.start}
                selected={asset.id === selectedId}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const AssetList = memo(AssetListView)

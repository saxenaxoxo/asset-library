import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { AssetRecord } from '@shared/library'
import type { AssetPages } from '../hooks/useAssetPages'
import type { AssetViewHandle } from '../types'
import { assetSummary } from '../lib/format'
import { AssetThumb } from './AssetThumb'
import { startAssetDrag } from '../lib/drag'

const MIN_TILE = 196
const GAP = 14
const CAPTION = 46
const PADDING = 20

interface AssetGridProps {
  pages: AssetPages
  selectedId: string | null
  onSelect: (asset: AssetRecord, index: number) => void
  onOpen: (asset: AssetRecord) => void
  ref?: React.Ref<AssetViewHandle>
}

interface AssetTileProps {
  asset: AssetRecord
  index: number
  selected: boolean
  width: number
  onSelect: (asset: AssetRecord, index: number) => void
  onOpen: (asset: AssetRecord) => void
}

function AssetTileView({
  asset,
  index,
  selected,
  width,
  onSelect,
  onOpen
}: AssetTileProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      draggable
      onDragStart={(event) => startAssetDrag(event, asset)}
      onClick={() => onSelect(asset, index)}
      onDoubleClick={() => onOpen(asset)}
      title={asset.relPath}
      className={`group rounded-lg p-1 text-left outline-none transition-colors ${
        selected ? 'bg-brand-surface ring-1 ring-brand-500' : 'hover:bg-raised/60'
      } focus-visible:ring-2 focus-visible:ring-brand-400`}
      style={{ width }}
    >
      <AssetThumb asset={asset} />
      <div className="mt-1.5 truncate px-0.5 text-sm text-ink">{asset.filename}</div>
      <div className="truncate px-0.5 text-xs text-ink-3">{assetSummary(asset)}</div>
    </button>
  )
}

const AssetTile = memo(AssetTileView)

function AssetGridView({
  pages,
  selectedId,
  onSelect,
  onOpen,
  ref
}: AssetGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // Measure before the first paint so the grid doesn't start as a single column.
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const inner = Math.max(0, width - PADDING * 2)
  const columns = Math.max(1, Math.floor((inner + GAP) / (MIN_TILE + GAP)))
  const tileWidth = columns > 0 ? (inner - GAP * (columns - 1)) / columns : MIN_TILE
  const rowHeight = Math.round((tileWidth * 9) / 16 + CAPTION + GAP)
  const rowCount = Math.ceil(pages.total / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  })

  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])

  // Keyboard navigation asks for scrolling directly, so a resize never replays an old request.
  useImperativeHandle(
    ref,
    () => ({
      columns,
      scrollToIndex: (index: number) => virtualizer.scrollToIndex(Math.floor(index / columns))
    }),
    [columns, virtualizer]
  )

  const rows = virtualizer.getVirtualItems()
  const firstRow = rows[0]?.index ?? 0
  const lastRow = rows[rows.length - 1]?.index ?? 0
  const { ensureRange } = pages
  useEffect(() => {
    ensureRange(firstRow * columns, (lastRow + 1) * columns - 1)
  }, [firstRow, lastRow, columns, ensureRange, pages.total])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" role="grid" aria-label="Assets">
      <div className="relative" style={{ height: virtualizer.getTotalSize() + PADDING * 2 }}>
        {rows.map((row) => (
          <div
            key={row.key}
            role="row"
            className="absolute flex"
            style={{
              top: row.start + PADDING,
              left: PADDING,
              right: PADDING,
              height: rowHeight - GAP,
              gap: GAP
            }}
          >
            {Array.from({ length: columns }, (_, column) => {
              const index = row.index * columns + column
              if (index >= pages.total) return <div key={column} style={{ width: tileWidth }} />
              const asset = pages.itemAt(index)
              if (!asset) {
                return (
                  <div key={column} style={{ width: tileWidth }} aria-busy="true">
                    <div className="aspect-video w-full animate-pulse rounded-md bg-raised" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-raised" />
                  </div>
                )
              }
              return (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  index={index}
                  selected={asset.id === selectedId}
                  width={tileWidth}
                  onSelect={onSelect}
                  onOpen={onOpen}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export const AssetGrid = memo(AssetGridView)

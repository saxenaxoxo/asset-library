import { useState } from 'react'
import { FolderSearch, GripVertical, Plus, Star, X } from 'lucide-react'
import type { AssetRecord, RootRecord } from '@shared/library'
import { formatBytes, formatDuration, formatResolution } from '../lib/format'
import { AssetThumb } from './AssetThumb'
import { startAssetDrag } from '../lib/drag'

interface DetailsPanelProps {
  asset: AssetRecord
  root: RootRecord | undefined
  onChanged: () => void
  onClose: () => void
}

function Row({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink-2">{value ?? '—'}</dd>
    </div>
  )
}

const STATUS_MESSAGE: Record<string, string> = {
  offline: 'This asset is on a drive that isn’t connected. Connect it and rescan.',
  missing: 'This file wasn’t found in the last scan. It may have been moved or deleted.',
  error: 'This file couldn’t be read.'
}

export function DetailsPanel({
  asset,
  root,
  onChanged,
  onClose
}: DetailsPanelProps): React.JSX.Element {
  const [tagDraft, setTagDraft] = useState('')
  const [revealFailed, setRevealFailed] = useState(false)

  async function toggleFavorite(): Promise<void> {
    await window.assetLibrary.setFavorite(asset.id, !asset.favorite)
    onChanged()
  }

  async function addTag(): Promise<void> {
    const name = tagDraft.trim()
    if (!name) return
    await window.assetLibrary.addTag(asset.id, name)
    setTagDraft('')
    onChanged()
  }

  async function removeTag(name: string): Promise<void> {
    await window.assetLibrary.removeTag(asset.id, name)
    onChanged()
  }

  async function reveal(): Promise<void> {
    setRevealFailed(!(await window.assetLibrary.revealAsset(asset.id)))
  }

  const location = root ? `${root.label}/${asset.relPath}` : asset.relPath

  return (
    <aside
      className="flex w-[320px] shrink-0 flex-col border-l border-line bg-panel"
      aria-label="Asset details"
    >
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="text-xs font-medium text-ink-3">Details</h2>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="rounded p-1 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div draggable onDragStart={(event) => startAssetDrag(event, asset)}>
          <AssetThumb asset={asset} large />
        </div>

        <div className="mt-3 flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold break-words">
            {asset.filename}
          </h3>
          <button
            type="button"
            onClick={() => void toggleFavorite()}
            aria-pressed={asset.favorite}
            aria-label={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
            className="rounded p-1 hover:bg-raised"
          >
            <Star
              size={16}
              className={asset.favorite ? 'fill-brand-400 text-brand-400' : 'text-ink-3'}
            />
          </button>
        </div>

        {STATUS_MESSAGE[asset.status] && (
          <p className="mt-2 rounded-md bg-raised px-3 py-2 text-xs leading-relaxed text-ink-2">
            {asset.status === 'error' && asset.errorMessage
              ? asset.errorMessage
              : STATUS_MESSAGE[asset.status]}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <div
            draggable
            onDragStart={(event) => startAssetDrag(event, asset)}
            className="flex h-9 flex-1 cursor-grab items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-sm font-medium text-on-brand hover:bg-brand-500 active:cursor-grabbing"
            title="Drag into Premiere Pro, After Effects or any app"
          >
            <GripVertical size={15} />
            Drag into your edit
          </div>
          <button
            type="button"
            onClick={() => void reveal()}
            title="Show in Finder or Explorer"
            aria-label="Show in Finder or Explorer"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-ink-2 hover:bg-raised"
          >
            <FolderSearch size={15} />
          </button>
        </div>
        {revealFailed && (
          <p className="mt-2 text-xs text-danger">The file isn’t where it was last seen.</p>
        )}

        <dl className="mt-5 divide-y divide-line">
          <Row
            label="Type"
            value={`${asset.kind[0]?.toUpperCase()}${asset.kind.slice(1)}, ${asset.ext.toUpperCase()}`}
          />
          {asset.kind !== 'audio' && (
            <Row label="Size" value={formatResolution(asset.width, asset.height)} />
          )}
          {(asset.kind === 'video' || asset.kind === 'audio') && (
            <Row label="Duration" value={formatDuration(asset.durationMs)} />
          )}
          {asset.kind === 'video' && (
            <Row label="Frame rate" value={asset.fps ? `${asset.fps} fps` : null} />
          )}
          {asset.kind !== 'template' && <Row label="Codec" value={asset.codec} />}
          {asset.kind === 'video' && (
            <Row
              label="Alpha"
              value={asset.hasAlpha === null ? null : asset.hasAlpha ? 'Yes' : 'No'}
            />
          )}
          {(asset.kind === 'audio' || asset.channels) && (
            <Row
              label="Audio"
              value={
                asset.channels
                  ? `${asset.channels === 2 ? 'Stereo' : asset.channels === 1 ? 'Mono' : `${asset.channels} ch`}${asset.sampleRate ? `, ${(asset.sampleRate / 1000).toFixed(1)} kHz` : ''}`
                  : null
              }
            />
          )}
          <Row label="File size" value={formatBytes(asset.size)} />
          <Row label="Modified" value={new Date(asset.mtime).toLocaleDateString()} />
          <Row label="Added" value={new Date(asset.addedAt).toLocaleDateString()} />
        </dl>

        <p className="mt-3 text-xs break-all text-ink-3" title={location}>
          {location}
        </p>

        <div className="mt-5">
          <h4 className="mb-2 text-xs font-medium text-ink-3">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {asset.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-xs text-ink-2"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => void removeTag(tag)}
                  className="text-ink-3 hover:text-ink"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              void addTag()
            }}
          >
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="glitch, lower third"
              aria-label="Add a tag"
              maxLength={60}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 text-sm placeholder:text-ink-3 focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Add tag"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-raised"
            >
              <Plus size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}

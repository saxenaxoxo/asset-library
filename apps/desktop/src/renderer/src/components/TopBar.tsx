import { forwardRef } from 'react'
import { LayoutGrid, List, RefreshCw, Search } from 'lucide-react'
import type { AssetSort } from '@shared/library'
import type { ViewMode } from '../types'

interface TopBarProps {
  title: string
  query: string
  onQueryChange: (query: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  sort: AssetSort
  onSortChange: (sort: AssetSort) => void
  onRescan: () => void
  isMac: boolean
}

const SORT_LABELS: Record<AssetSort, string> = {
  added: 'Date added',
  name: 'Name',
  modified: 'Date modified',
  size: 'File size',
  duration: 'Duration'
}

function IconButton({
  label,
  pressed,
  onClick,
  children
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`no-drag inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        pressed ? 'bg-raised text-ink' : 'text-ink-3 hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export const TopBar = forwardRef<HTMLInputElement, TopBarProps>(function TopBar(
  { title, query, onQueryChange, viewMode, onViewModeChange, sort, onSortChange, onRescan, isMac },
  searchRef
) {
  return (
    <header className="drag-region flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>

      <label className="no-drag relative flex h-8 w-[320px] items-center">
        <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search names, folders and tags"
          aria-label="Search assets"
          className="h-full w-full rounded-md border border-line bg-canvas pr-12 pl-8 text-sm text-ink placeholder:text-ink-3 focus:border-brand-500 focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 rounded border border-line px-1 text-2xs text-ink-3">
          {isMac ? '⌘F' : 'Ctrl F'}
        </kbd>
      </label>

      <select
        aria-label="Sort by"
        value={sort}
        onChange={(event) => onSortChange(event.target.value as AssetSort)}
        className="no-drag h-8 rounded-md border border-line bg-canvas px-2 text-sm text-ink-2 focus:border-brand-500 focus:outline-none"
      >
        {Object.entries(SORT_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
        <IconButton
          label="Grid view"
          pressed={viewMode === 'grid'}
          onClick={() => onViewModeChange('grid')}
        >
          <LayoutGrid size={15} />
        </IconButton>
        <IconButton
          label="List view"
          pressed={viewMode === 'list'}
          onClick={() => onViewModeChange('list')}
        >
          <List size={15} />
        </IconButton>
      </div>

      <IconButton label="Rescan folders" onClick={onRescan}>
        <RefreshCw size={15} />
      </IconButton>
    </header>
  )
})

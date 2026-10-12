import type { LucideIcon } from 'lucide-react'
import {
  AudioLines,
  Clock3,
  Film,
  Folder,
  HardDrive,
  Image,
  Layers,
  LayoutGrid,
  LoaderCircle,
  Plus,
  SearchX,
  Settings,
  Star,
  Tag,
  Trash2,
  Unplug
} from 'lucide-react'
import { brand } from '@brand/brand-config'
import type { LibraryCounts, RootRecord, TagCount } from '@shared/library'
import { BrandMark } from './BrandMark'
import type { ViewId } from '../types'

interface SidebarProps {
  activeView: ViewId
  onSelectView: (view: ViewId) => void
  roots: RootRecord[]
  counts: LibraryCounts | null
  tags: TagCount[]
  onAddFolder: () => void
  onRemoveRoot: (root: RootRecord) => void
}

function NavItem({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  trailing,
  dim
}: {
  icon: LucideIcon
  label: string
  count?: number
  active: boolean
  onClick: () => void
  trailing?: React.ReactNode
  dim?: boolean
}): React.JSX.Element {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors ${
          active ? 'bg-brand-surface text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'
        } ${dim ? 'opacity-60' : ''}`}
      >
        <Icon size={16} strokeWidth={1.75} className={active ? 'text-brand-300' : 'text-ink-3'} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span
            className={`text-2xs text-ink-3 group-hover:opacity-0 ${
              trailing ? 'group-focus-within:opacity-0' : ''
            }`}
          >
            {count.toLocaleString()}
          </span>
        )}
      </button>
      {trailing}
    </div>
  )
}

function SectionHeading({
  children,
  action
}: {
  children: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-5 mb-1 flex h-6 items-center justify-between px-2.5">
      <h2 className="text-2xs font-medium text-ink-3">{children}</h2>
      {action}
    </div>
  )
}

export function Sidebar({
  activeView,
  onSelectView,
  roots,
  counts,
  tags,
  onAddFolder,
  onRemoveRoot
}: SidebarProps): React.JSX.Element {
  const nav = (id: ViewId, label: string, icon: LucideIcon, count?: number): React.JSX.Element => (
    <NavItem
      key={id}
      icon={icon}
      label={label}
      count={count}
      active={activeView === id}
      onClick={() => onSelectView(id)}
    />
  )

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      {/* Space for the macOS traffic lights; also lets the window be dragged from here. */}
      <div className="drag-region h-11 shrink-0" />

      <div className="flex items-center gap-2.5 px-4 pb-3">
        <BrandMark size={28} />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">{brand.productName}</div>
          <div className="text-2xs text-ink-3">{brand.attribution}</div>
        </div>
      </div>

      <nav aria-label="Library" className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="mt-2 space-y-0.5">
          {nav('all', 'All assets', LayoutGrid, counts?.total)}
          {nav('favorites', 'Favorites', Star, counts?.favorites)}
          {nav('recent', 'Recently added', Clock3)}
        </div>

        <SectionHeading>Types</SectionHeading>
        <div className="space-y-0.5">
          {nav('video', 'Video', Film, counts?.video)}
          {nav('audio', 'Audio', AudioLines, counts?.audio)}
          {nav('images', 'Images', Image, counts?.image)}
          {nav('templates', 'Templates and presets', Layers, counts?.template)}
        </div>

        <SectionHeading
          action={
            <button
              type="button"
              onClick={onAddFolder}
              aria-label="Add folder"
              title="Add folder"
              className="rounded p-0.5 text-ink-3 hover:bg-raised hover:text-ink"
            >
              <Plus size={14} />
            </button>
          }
        >
          Folders
        </SectionHeading>
        {roots.length === 0 ? (
          <p className="px-2.5 text-xs text-ink-3">No folders yet</p>
        ) : (
          <div className="space-y-0.5">
            {roots.map((root) => {
              const id: ViewId = `root:${root.id}`
              const icon = root.scanning
                ? LoaderCircle
                : root.status === 'offline'
                  ? Unplug
                  : root.path.startsWith('/Volumes/')
                    ? HardDrive
                    : Folder
              return (
                <NavItem
                  key={root.id}
                  icon={icon}
                  label={root.label}
                  count={root.assetCount}
                  dim={root.status === 'offline'}
                  active={activeView === id}
                  onClick={() => onSelectView(id)}
                  trailing={
                    <button
                      type="button"
                      onClick={() => onRemoveRoot(root)}
                      aria-label={`Remove ${root.label} from the library`}
                      title="Remove from library (files stay on disk)"
                      className="absolute top-1.5 right-1.5 rounded p-1 text-ink-3 opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-canvas hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  }
                />
              )
            })}
          </div>
        )}

        <SectionHeading>Tags</SectionHeading>
        {tags.length === 0 ? (
          <p className="px-2.5 text-xs text-ink-3">Tags you add appear here</p>
        ) : (
          <div className="space-y-0.5">
            {tags.map((tag) => nav(`tag:${tag.name}`, tag.name, Tag, tag.count))}
          </div>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-line px-2 py-2">
        {nav('missing', 'Missing', SearchX, counts?.missing)}
        {nav('settings', 'Settings', Settings)}
      </div>
    </aside>
  )
}

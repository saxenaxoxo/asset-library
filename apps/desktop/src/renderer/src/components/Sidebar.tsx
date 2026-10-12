import type { LucideIcon } from 'lucide-react'
import {
  AudioLines,
  Clock3,
  Film,
  Folder,
  Image,
  Layers,
  LayoutGrid,
  Plus,
  Settings,
  SearchX,
  Star
} from 'lucide-react'
import { brand } from '@brand/brand-config'
import { BrandMark } from './BrandMark'
import type { LibraryRoot, ViewId } from '../types'

interface SidebarProps {
  activeView: ViewId
  onSelectView: (view: ViewId) => void
  roots: LibraryRoot[]
  onAddFolder: () => void
}

interface NavEntry {
  id: ViewId
  label: string
  icon: LucideIcon
}

const LIBRARY: NavEntry[] = [
  { id: 'all', label: 'All assets', icon: LayoutGrid },
  { id: 'favorites', label: 'Favorites', icon: Star },
  { id: 'recent', label: 'Recently added', icon: Clock3 }
]

const TYPES: NavEntry[] = [
  { id: 'video', label: 'Video', icon: Film },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'images', label: 'Images', icon: Image },
  { id: 'templates', label: 'Templates and presets', icon: Layers }
]

function NavItem({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors ${
        active ? 'bg-brand-surface text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'
      }`}
    >
      <Icon size={16} strokeWidth={1.75} className={active ? 'text-brand-300' : 'text-ink-3'} />
      <span className="truncate">{label}</span>
    </button>
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
  onAddFolder
}: SidebarProps): React.JSX.Element {
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
          {LIBRARY.map((entry) => (
            <NavItem
              key={entry.id}
              {...entry}
              active={activeView === entry.id}
              onClick={() => onSelectView(entry.id)}
            />
          ))}
        </div>

        <SectionHeading>Types</SectionHeading>
        <div className="space-y-0.5">
          {TYPES.map((entry) => (
            <NavItem
              key={entry.id}
              {...entry}
              active={activeView === entry.id}
              onClick={() => onSelectView(entry.id)}
            />
          ))}
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
          <ul className="space-y-0.5">
            {roots.map((root) => (
              <li key={root.path}>
                <NavItem
                  icon={Folder}
                  label={root.name}
                  active={activeView === `root:${root.path}`}
                  onClick={() => onSelectView(`root:${root.path}`)}
                />
              </li>
            ))}
          </ul>
        )}

        <SectionHeading>Tags</SectionHeading>
        <p className="px-2.5 text-xs text-ink-3">Tags you add appear here</p>
      </nav>

      <div className="space-y-0.5 border-t border-line px-2 py-2">
        <NavItem
          icon={SearchX}
          label="Missing"
          active={activeView === 'missing'}
          onClick={() => onSelectView('missing')}
        />
        <NavItem
          icon={Settings}
          label="Settings"
          active={activeView === 'settings'}
          onClick={() => onSelectView('settings')}
        />
      </div>
    </aside>
  )
}

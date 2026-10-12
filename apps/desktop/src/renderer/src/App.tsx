import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppInfo } from '@shared/api'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'
import { DragTest } from './components/DragTest'
import type { LibraryRoot, SortKey, ViewId, ViewMode } from './types'

const VIEW_TITLES: Record<string, string> = {
  all: 'All assets',
  favorites: 'Favorites',
  recent: 'Recently added',
  video: 'Video',
  audio: 'Audio',
  images: 'Images',
  templates: 'Templates and presets',
  missing: 'Missing',
  settings: 'Settings'
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export default function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  // Session-only until the library database lands in M3.
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [lastAddedName, setLastAddedName] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewId>('all')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortKey>('added')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.assetLibrary.getAppInfo().then(setAppInfo)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const addFolder = useCallback(async () => {
    const picked = await window.assetLibrary.pickFolder()
    if (!picked) return
    const root = { path: picked.path, name: folderName(picked.path) }
    setRoots((current) =>
      current.some((existing) => existing.path === root.path) ? current : [...current, root]
    )
    setLastAddedName(root.name)
  }, [])

  const title = activeView.startsWith('root:')
    ? folderName(activeView.slice('root:'.length))
    : (VIEW_TITLES[activeView] ?? 'All assets')

  return (
    <div className="flex h-full">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        roots={roots}
        onAddFolder={() => void addFolder()}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          ref={searchRef}
          title={title}
          query={query}
          onQueryChange={setQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          onSortChange={setSort}
          onRescan={() => undefined}
          isMac={appInfo?.platform === 'darwin'}
        />
        {activeView === 'settings' ? (
          <DragTest />
        ) : (
          <EmptyState onAddFolder={() => void addFolder()} lastAddedName={lastAddedName} />
        )}
        <StatusBar assetCount={0} folderCount={roots.length} version={appInfo?.version ?? null} />
      </main>
    </div>
  )
}

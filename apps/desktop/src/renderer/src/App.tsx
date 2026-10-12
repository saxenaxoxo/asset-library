import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchX } from 'lucide-react'
import type { AppInfo } from '@shared/api'
import type {
  AssetQuery,
  AssetRecord,
  AssetSort,
  LibraryCounts,
  RootRecord,
  ScanProgress,
  TagCount
} from '@shared/library'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'
import { AssetGrid } from './components/AssetGrid'
import { AssetList } from './components/AssetList'
import { DetailsPanel } from './components/DetailsPanel'
import { SettingsView } from './components/SettingsView'
import { useAssetPages } from './hooks/useAssetPages'
import type { ViewId, ViewMode } from './types'

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

function queryForView(view: ViewId): AssetQuery {
  if (view.startsWith('root:')) return { rootId: Number(view.slice(5)) }
  if (view.startsWith('tag:')) return { tag: view.slice(4) }
  switch (view) {
    case 'favorites':
      return { favoritesOnly: true }
    case 'recent':
      return { recentOnly: true }
    case 'video':
      return { kind: 'video' }
    case 'audio':
      return { kind: 'audio' }
    case 'images':
      return { kind: 'image' }
    case 'templates':
      return { kind: 'template' }
    case 'missing':
      return { missingOnly: true }
    default:
      return {}
  }
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  )
}

export default function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [roots, setRoots] = useState<RootRecord[] | null>(null)
  const [counts, setCounts] = useState<LibraryCounts | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [progress, setProgress] = useState<Record<number, ScanProgress>>({})
  const [activeView, setActiveView] = useState<ViewId>('all')
  const [text, setText] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<AssetSort>('added')
  const [selected, setSelected] = useState<{ id: string; index: number } | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null)
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const debouncedText = useDebounced(text, 150)
  const query = useMemo<AssetQuery>(
    () => ({ ...queryForView(activeView), sort, text: debouncedText || undefined }),
    [activeView, sort, debouncedText]
  )
  const pages = useAssetPages(query, refreshKey)

  const reloadLibrary = useCallback(() => {
    void window.assetLibrary.listRoots().then(setRoots)
    void window.assetLibrary.getCounts().then(setCounts)
    void window.assetLibrary.listTags().then(setTags)
  }, [])

  useEffect(() => {
    void window.assetLibrary.getAppInfo().then(setAppInfo)
    reloadLibrary()
    return window.assetLibrary.onLibraryEvent((event) => {
      if (event.type === 'scan-progress') {
        setProgress((current) => ({ ...current, [event.progress.rootId]: event.progress }))
        if (event.progress.state !== 'scanning') reloadLibrary()
      } else {
        setRefreshKey((key) => key + 1)
        reloadLibrary()
      }
    })
  }, [reloadLibrary])

  // Keep the details panel in sync with the selection and with library changes.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    void window.assetLibrary.getAsset(selected.id).then((asset) => {
      if (!cancelled) setSelectedAsset(asset)
    })
    return () => {
      cancelled = true
    }
  }, [selected, refreshKey])

  const select = useCallback((asset: AssetRecord, index: number) => {
    setSelected({ id: asset.id, index })
  }, [])

  const addFolder = useCallback(async () => {
    const root = await window.assetLibrary.addFolder()
    if (root) {
      reloadLibrary()
      setActiveView('all')
    }
  }, [reloadLibrary])

  const removeRoot = useCallback(
    async (root: RootRecord) => {
      const confirmed = window.confirm(
        `Remove “${root.label}” from Asset Library?\n\nYour files stay where they are; only the library entry, tags and favorites for this folder are removed.`
      )
      if (!confirmed) return
      await window.assetLibrary.removeRoot(root.id)
      if (activeView === `root:${root.id}`) setActiveView('all')
      setSelected(null)
      reloadLibrary()
      setRefreshKey((key) => key + 1)
    },
    [activeView, reloadLibrary]
  )

  const changeView = useCallback((view: ViewId) => {
    setActiveView(view)
    setSelected(null)
  }, [])

  // Keyboard: Cmd/Ctrl+F search, arrows move, F favorite, Enter reveal, Esc closes details.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (isTyping(event.target) || activeView === 'settings') return
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      if (move !== undefined && pages.total > 0) {
        event.preventDefault()
        const next = Math.min(pages.total - 1, Math.max(0, (selected?.index ?? -1) + move))
        const asset = pages.itemAt(next)
        if (asset) {
          setSelected({ id: asset.id, index: next })
          setScrollToIndex(next)
        }
        return
      }
      const current = selected && selectedAsset?.id === selected.id ? selectedAsset : null
      if (!current) return
      if (event.key === 'Escape') setSelected(null)
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) {
        void window.assetLibrary
          .setFavorite(current.id, !current.favorite)
          .then(() => setRefreshKey((key) => key + 1))
      }
      if (event.key === 'Enter') void window.assetLibrary.revealAsset(current.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeView, pages, selected, selectedAsset])

  // Only show details for the current selection (avoids a stale panel after deselecting).
  const shownAsset = selected && selectedAsset?.id === selected.id ? selectedAsset : null

  const title = activeView.startsWith('root:')
    ? (roots?.find((r) => `root:${r.id}` === activeView)?.label ?? 'Folder')
    : activeView.startsWith('tag:')
      ? `Tagged “${activeView.slice(4)}”`
      : (VIEW_TITLES[activeView] ?? 'All assets')

  const scanningAny = Object.values(progress).some((p) => p.state === 'scanning')
  const showEmptyLibrary = roots !== null && roots.length === 0 && activeView !== 'settings'

  let content: React.JSX.Element
  if (activeView === 'settings') {
    content = <SettingsView roots={roots ?? []} onRemoveRoot={(root) => void removeRoot(root)} />
  } else if (showEmptyLibrary) {
    content = <EmptyState onAddFolder={() => void addFolder()} />
  } else if (pages.error) {
    content = (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Couldn&apos;t load assets: {pages.error}
      </div>
    )
  } else if (!pages.loading && pages.total === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <SearchX size={28} strokeWidth={1.5} className="text-ink-3" />
        <p className="text-sm text-ink">
          {debouncedText
            ? `Nothing matches “${debouncedText}”`
            : scanningAny
              ? 'Scanning your folders…'
              : 'Nothing here yet'}
        </p>
        <p className="max-w-[340px] text-xs text-ink-3">
          {debouncedText
            ? 'Try a shorter word, part of a folder name, or a tag.'
            : activeView === 'favorites'
              ? 'Star assets you use often and they collect here.'
              : activeView === 'missing'
                ? 'Files that disappear from your folders show up here, with their tags kept.'
                : 'Assets of this kind appear here once your folders are scanned.'}
        </p>
      </div>
    )
  } else {
    const View = viewMode === 'grid' ? AssetGrid : AssetList
    content = (
      <View
        pages={pages}
        selectedId={selected?.id ?? null}
        onSelect={select}
        onOpen={(asset) => void window.assetLibrary.revealAsset(asset.id)}
        scrollToIndex={scrollToIndex}
      />
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar
        activeView={activeView}
        onSelectView={changeView}
        roots={roots ?? []}
        counts={counts}
        tags={tags}
        onAddFolder={() => void addFolder()}
        onRemoveRoot={(root) => void removeRoot(root)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          ref={searchRef}
          title={title}
          query={text}
          onQueryChange={setText}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          onSortChange={setSort}
          onRescan={() => void window.assetLibrary.rescan()}
          isMac={appInfo?.platform === 'darwin'}
        />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{content}</div>
          {shownAsset && activeView !== 'settings' && (
            <DetailsPanel
              asset={shownAsset}
              root={roots?.find((r) => r.id === shownAsset.rootId)}
              onChanged={() => {
                setRefreshKey((key) => key + 1)
                reloadLibrary()
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
        <StatusBar
          total={counts?.total ?? 0}
          shown={pages.total}
          folderCount={roots?.length ?? 0}
          progress={Object.values(progress)}
          version={appInfo?.version ?? null}
        />
      </main>
    </div>
  )
}

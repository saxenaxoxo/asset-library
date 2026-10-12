// Asset Library panel for Premiere Pro: the whole product. Browse the library like a file
// manager, preview, organize (favorites, tags, folders), import, and put assets on the timeline.
// A background engine does the indexing and thumbnails; the panel talks to it through files.
import type { Catalog, CatalogAsset, CatalogKind } from '@catalog/types'
import {
  applyCatalogDelta,
  CATALOG_DELTA_FILE,
  parseCatalogDelta,
  SPRITE_FRAMES
} from '@catalog/types'
import { filterAssets, formatDuration } from '@catalog/filter'
import { rangeBetween, recordRecent, RECENT_KEY } from '@catalog/selection'
import {
  ALL_KEY,
  buildFolderTree,
  FAVORITES_KEY,
  findFolder,
  folderKey,
  folderTrail,
  inFolder,
  TAG_PREFIX,
  tagKey,
  type FolderNode
} from '@catalog/tree'
import type { EngineStatus, PanelRequest } from '@catalog/requests'
import {
  chooseCatalog,
  fileMissing,
  joinPath,
  loadCatalog,
  locateCatalog,
  mimeFor,
  modifiedTime,
  pickFiles,
  pickFolder,
  readText,
  showLocalImage,
  splitPath
} from './files'
import { detectWindows, storage } from './host'
import { placeAtPlayhead, UserError, type InsertOptions } from './premiere'
import { dragContentType, DRAG_MIN_MAJOR, fileUri, hostMajor, samePath } from './paths'
import { engineRunning, readEngineStatus, removeRequest, sendRequest, startEngine } from './engine'
import { installDiagnostics, note } from './diag'

/** Set by the build: true only for a `--diag` build. */
declare const PANEL_DIAG: boolean

const uxp = require('uxp')
const canDrag = hostMajor(uxp.host.version) >= DRAG_MIN_MAJOR
const WINDOWS = detectWindows()
const PANEL_VERSION = '0.3.22'

const TILE_SIZES = { min: 80, max: 240, default: 120 }
const TREE_ROW = 26
const GAP = 8
const CAPTION = 34
const POLL_MS = 3000
const ENGINE_POLL_MS = 2000
/** A request the engine hasn't picked up by now means it isn't running. */
const REQUEST_TIMEOUT_MS = 12_000
/** Below this panel width the folder tree hides itself (the toolbar button brings it back). */
const NARROW_PX = 340

const KEYS = {
  options: 'assetLibrary.insertOptions',
  view: 'assetLibrary.view',
  folder: 'assetLibrary.folder',
  expanded: 'assetLibrary.expanded',
  tree: 'assetLibrary.tree',
  treeWidth: 'assetLibrary.treeWidth',
  tileSize: 'assetLibrary.tileSize',
  recent: 'assetLibrary.recent',
  scope: 'assetLibrary.searchScope'
}
/** Successes fade from the status line after this long; problems stay until the next action. */
const STATUS_OK_MS = 6000
const RECENT_MAX = 50

type KindFilter = CatalogKind | 'all'
type Tone = 'ok' | 'error' | 'info'

interface PendingRequest {
  label: string
  at: number
  request: PanelRequest
}

interface State {
  catalogPath: string | null
  catalog: Catalog | null
  catalogMtime: number | null
  error: string | null
  tab: 'library' | 'settings'
  view: 'folders' | 'all'
  folder: string
  expanded: Set<string>
  /** False until the editor opens or closes a folder; until then library folders start open. */
  expandedSaved: boolean
  treePref: 'auto' | 'shown' | 'hidden'
  /** Width the editor dragged the tree to, or null for the default. */
  treeWidth: number | null
  /** Smallest tile width (the size slider). */
  tileSize: number
  text: string
  /** Where a search looks: the open folder, or the whole library. */
  searchScope: 'folder' | 'all'
  kind: KindFilter
  favoritesOnly: boolean
  visible: CatalogAsset[]
  /** The asset keyboard and actions work on; always one of `selectedIds` when set. */
  selectedId: string | null
  selectedIds: Set<string>
  /** Where a shift-click range starts. */
  anchorId: string | null
  /** IDs placed on the timeline, newest first. */
  recent: string[]
  /** Seq of the catalog delta applied on top of the full catalog (0: none). */
  deltaSeq: number
  /** The login setting as the editor just set it, until the engine confirms. */
  loginEdit: boolean | null
  /** The audio asset the engine is playing for the panel. */
  playingId: string | null
  status: { text: string; tone: Tone } | null
  options: InsertOptions
  busy: boolean
  engine: EngineStatus | null
  pending: Map<string, PendingRequest>
  /** Favorite and tag edits shown right away, until the catalog catches up. */
  favoriteEdits: Map<string, boolean>
  tagEdits: Map<string, string[]>
  /** A folder the editor just added; it's selected as soon as it shows up. */
  awaitingRoot: string | null
  editingTag: boolean
  confirmRemove: number | null
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(storage.get(key) ?? 'null') as T | null
    return value ?? fallback
  } catch {
    return fallback
  }
}

function loadOptions(): InsertOptions {
  const saved = readJson<InsertOptions | null>(KEYS.options, null)
  if (saved && typeof saved.videoTrack === 'number') return saved
  return { videoTrack: 1, audioTrack: 1, mode: 'overwrite' }
}

const state: State = {
  catalogPath: null,
  catalog: null,
  catalogMtime: null,
  error: null,
  tab: 'library',
  view: 'folders',
  folder: readJson<string>(KEYS.folder, ALL_KEY),
  expanded: new Set(readJson<string[]>(KEYS.expanded, [])),
  expandedSaved: storage.get(KEYS.expanded) !== null,
  treePref: readJson<State['treePref']>(KEYS.tree, 'auto'),
  treeWidth: readJson<number | null>(KEYS.treeWidth, null),
  tileSize: readJson<number>(KEYS.tileSize, TILE_SIZES.default),
  text: '',
  searchScope: readJson<State['searchScope']>(KEYS.scope, 'folder'),
  kind: 'all',
  favoritesOnly: false,
  visible: [],
  selectedId: null,
  selectedIds: new Set(),
  anchorId: null,
  recent: readJson<string[]>(KEYS.recent, []),
  deltaSeq: 0,
  loginEdit: null,
  playingId: null,
  status: null,
  options: loadOptions(),
  busy: false,
  engine: null,
  pending: new Map(),
  favoriteEdits: new Map(),
  tagEdits: new Map(),
  awaitingRoot: null,
  editingTag: false,
  confirmRemove: null
}

function save(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value))
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label: string, className: string, run: () => void, title?: string): HTMLElement {
  const node = el('div', `button ${className}`.trim(), label)
  if (title) node.title = title
  node.setAttribute('role', 'button')
  node.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!node.classList.contains('disabled')) run()
  })
  return node
}

function setDisabled(node: HTMLElement, disabled: boolean): void {
  if (disabled) node.classList.add('disabled')
  else node.classList.remove('disabled')
}

function show(node: HTMLElement, visible: boolean): void {
  const value = visible ? '' : 'none'
  if (node.style.display !== value) node.style.display = value
}

const app = document.getElementById('app') as HTMLElement

// Top bar: Browse and Settings tabs.
const topbar = el('div', 'topbar')
const browseTab = el('div', 'tab', 'Browse')
const settingsTab = el('div', 'tab', 'Settings')
topbar.append(browseTab, settingsTab)

// Search, with a favorites-only star.
const header = el('div', 'header')
const favoritesToggle = el('div', 'icon-button star-toggle', '★')
favoritesToggle.title = 'Show only Favorites'
const search = el('input', 'search')
search.placeholder = 'Search names, folders and tags'
search.setAttribute('aria-label', 'Search assets')
// Where a search looks; shown while a folder is open.
const scopeSelect = el('select', 'scope-select')
scopeSelect.setAttribute('aria-label', 'Search in')
for (const [value, label] of [
  ['folder', 'This folder'],
  ['all', 'Everything']
] as const) {
  const option = el('option', '', label)
  option.value = value
  scopeSelect.append(option)
}
scopeSelect.value = state.searchScope
header.append(favoritesToggle, search, scopeSelect)

// Library: the folder tree (folders and files), a divider you can drag, and the grid.
const body = el('div', 'body')
const treePane = el('div', 'tree')
const treeHead = el('div', 'tree-head')
// The tree pane scrolls itself, header included (one scroll box, as in the 0.2 panel: Premiere's
// panel runtime didn't deliver clicks into a scroll box nested in a column layout here).
const treeScroll = treePane
const treeSpacer = el('div')
treeSpacer.style.position = 'relative'
treePane.append(treeHead, treeSpacer)
const TREE_HEAD = 31
const splitter = el('div', 'splitter', '⋮')
splitter.title = 'Drag to resize'
const mainPane = el('div', 'main')
const toolbar = el('div', 'toolbar')
// Built once and only updated: Premiere's panel runtime gives elements added later inside
// this nested layout no size, so they draw but can't be clicked.
const treeToggle = el('div', 'icon-button', '☰')
const upButton = el('div', 'icon-button', '‹')
upButton.title = 'Up one folder'
const crumbs = el('div', 'crumbs')
const importButton = el('div', 'button', 'Import')
// A folder picker: a native menu, which Premiere's panel runtime reliably sends clicks to.
const folderSelect = el('select', 'folder-select')
folderSelect.setAttribute('aria-label', 'Folder')
const typeSelect = el('select', 'type-select')
typeSelect.setAttribute('aria-label', 'Type')
for (const [value, label] of [
  ['all', 'All types'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['image', 'Images'],
  ['template', 'Templates']
] as const) {
  const option = el('option', '', label)
  option.value = value
  typeSelect.append(option)
}
const sizeSlider = el('input', 'size-slider')
sizeSlider.type = 'range'
sizeSlider.min = String(TILE_SIZES.min)
sizeSlider.max = String(TILE_SIZES.max)
sizeSlider.step = '4'
sizeSlider.value = String(state.tileSize)
sizeSlider.title = 'Thumbnail size'
sizeSlider.setAttribute('aria-label', 'Thumbnail size')
toolbar.append(treeToggle, upButton, folderSelect, typeSelect, importButton, sizeSlider)
const addFolderButton = el('div', 'button small', '+ Folder')
addFolderButton.title = 'Add a folder to your library'
treeHead.append(el('span', 'tree-title', 'Library'), addFolderButton)
const grid = el('div', 'grid')
grid.tabIndex = 0 // so the keyboard works after a click in the grid
mainPane.append(toolbar, grid)
body.append(treePane, splitter, mainPane)

// Settings.
const settingsPane = el('div', 'settings')

// Footer: tags of the selection, placement choices, the main action; then size and status.
const footer = el('div', 'footer')
const tagRow = el('div', 'tag-row')
const controls = el('div', 'controls')
const bottomRow = el('div', 'bottom-row')
// Engine work in progress: a thin bar that fills as previews get made.
const progressBar = el('div', 'progress')
const progressFill = el('div', 'progress-fill')
progressBar.append(progressFill)
const statusLine = el('div', 'status')
bottomRow.append(progressBar, statusLine)
footer.append(tagRow, controls, bottomRow)

app.append(topbar, header, body, settingsPane, footer)

let statusTimer: ReturnType<typeof setTimeout> | undefined

function setStatus(text: string, tone: Tone = 'info'): void {
  state.status = { text, tone }
  clearTimeout(statusTimer)
  if (tone === 'ok')
    statusTimer = setTimeout(() => {
      if (state.status?.text === text) {
        state.status = null
        renderFooter()
      }
    }, STATUS_OK_MS)
  renderFooter()
}

// ── Data ────────────────────────────────────────────────────────────────────

/** The asset as the editor should see it, with their latest favorite/tag edits applied. */
function effective(asset: CatalogAsset): CatalogAsset {
  const favorite = state.favoriteEdits.get(asset.id)
  const tags = state.tagEdits.get(asset.id)
  if (favorite === undefined && tags === undefined) return asset
  return { ...asset, favorite: favorite ?? asset.favorite, tags: tags ?? asset.tags }
}

/** Drops edits the catalog now reflects. */
function settleEdits(catalog: Catalog): void {
  if (state.favoriteEdits.size === 0 && state.tagEdits.size === 0) return
  const byId = new Map(catalog.assets.map((asset) => [asset.id, asset]))
  for (const [id, favorite] of state.favoriteEdits) {
    const asset = byId.get(id)
    if (!asset || asset.favorite === favorite) state.favoriteEdits.delete(id)
  }
  for (const [id, tags] of state.tagEdits) {
    const asset = byId.get(id)
    const same =
      asset &&
      asset.tags.length === tags.length &&
      tags.every((tag) => asset.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
    if (!asset || same) state.tagEdits.delete(id)
  }
}

let treeFor: { catalog: Catalog; tree: FolderNode[] } | null = null

/** The folder tree of the current catalog, built once per catalog. */
function folderTree(): FolderNode[] {
  const catalog = state.catalog
  if (!catalog) return []
  if (treeFor?.catalog !== catalog) treeFor = { catalog, tree: buildFolderTree(catalog) }
  return treeFor.tree
}

function scopeAssets(): CatalogAsset[] {
  const catalog = state.catalog
  if (!catalog) return []
  const all = catalog.assets.map(effective)
  if (state.view !== 'folders') return all
  if (state.folder === RECENT_KEY) {
    const order = new Map(state.recent.map((id, index) => [id, index]))
    return all
      .filter((a) => order.has(a.id))
      .sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number))
  }
  if (state.text && state.searchScope === 'all') return all
  return all.filter((a) => inFolder(a, catalog, state.folder))
}

/**
 * Recomputes the visible assets. `resetScroll` is for the editor's own changes (search, filter,
 * folder); background catalog updates keep the scroll position.
 */
function applyFilter(resetScroll: boolean, rebuildTree = true): void {
  const scoped = scopeAssets()
  state.visible = filterAssets(scoped, {
    text: state.text,
    kind: state.kind,
    favoritesOnly: state.favoritesOnly
  })
  if (state.folder === RECENT_KEY && state.view === 'folders') {
    // Recent keeps its own order: what was placed last comes first.
    const order = new Map(scoped.map((a, index) => [a.id, index]))
    state.visible.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number))
  }
  const shown = new Set(state.visible.map((a) => a.id))
  for (const id of state.selectedIds) if (!shown.has(id)) state.selectedIds.delete(id)
  if (state.selectedId && !shown.has(state.selectedId)) {
    state.selectedId = null
    state.editingTag = false
  }
  if (resetScroll) grid.scrollTop = 0
  renderAll(rebuildTree)
}

const EMPTY_CATALOG = (): Catalog => ({
  version: 1,
  updatedAt: 0,
  app: '',
  roots: [],
  tags: [],
  assets: []
})

/** Without any change signal, the catalog is re-read at most this often. */
const BLIND_READ_MS = 15_000
let lastBlindRead = 0

/** Bumped by every refresh; a refresh whose number is no longer current drops its result. */
let refreshGeneration = 0
let refreshesInFlight = 0

async function loadLatestCatalog(run: number, force: boolean): Promise<void> {
  const stale = (path: string | null): boolean =>
    run !== refreshGeneration || state.catalogPath !== path
  if (!state.catalogPath) {
    const located = await locateCatalog()
    if (stale(null)) return
    state.catalogPath = located
  }
  const path = state.catalogPath
  if (!path) {
    state.error = "Couldn't find your Asset Library catalog. Choose it to continue."
    renderAll()
    return
  }
  // Small changes arrive as a delta file against the full catalog already loaded.
  const live = engineRunning(state.engine) ? state.engine?.catalog : undefined
  if (!force && live && state.catalog?.generation === live.generation) {
    if (live.deltaSeq === state.deltaSeq) return
    if (live.deltaSeq === 0) {
      state.deltaSeq = 0 // the engine dropped its delta; the full catalog is current
      return
    }
    let delta = null
    try {
      delta = parseCatalogDelta(await readText(joinPath(splitPath(path).dir, CATALOG_DELTA_FILE)))
    } catch {
      delta = null
    }
    if (stale(path)) return
    if (delta && delta.generation === live.generation) {
      if (delta.seq !== state.deltaSeq) {
        state.catalog = applyCatalogDelta(state.catalog, delta)
        state.deltaSeq = delta.seq
        catalogLoaded(state.catalog)
      }
      return
    }
    // An unusable delta: read the whole catalog below.
  }
  // The catalog can be many MB, so only read it when it has changed: the engine says when it
  // last wrote one, else the file's modified time, else every so often.
  const cue = engineRunning(state.engine) ? state.engine?.catalogUpdatedAt : undefined
  const mtime = cue === undefined ? await modifiedTime(path) : null
  if (stale(path)) return
  if (!force && state.catalog && state.catalog.updatedAt !== 0) {
    if (cue !== undefined && cue === state.catalog.updatedAt) return
    if (cue === undefined && mtime !== null && mtime === state.catalogMtime) return
    if (cue === undefined && mtime === null && Date.now() - lastBlindRead < BLIND_READ_MS) return
  }
  if (mtime === null && cue === undefined) lastBlindRead = Date.now()
  let catalog: Catalog
  try {
    catalog = await loadCatalog(path)
  } catch (error) {
    if (stale(path)) return
    if (!(await fileMissing(path))) throw error
    // No catalog yet: the engine hasn't run. Show an empty library the editor can start filling.
    if (!state.catalog || state.catalog.updatedAt !== 0 || force) {
      state.catalog = EMPTY_CATALOG()
      state.error = null
      applyFilter(false)
    }
    return
  }
  if (stale(path)) return
  // Remember the time even when nothing changed, so the next poll doesn't parse it again.
  state.catalogMtime = mtime
  if (
    !force &&
    state.catalog &&
    catalog.updatedAt === state.catalog.updatedAt &&
    catalog.generation === state.catalog.generation
  )
    return
  state.catalog = catalog
  state.deltaSeq = 0
  state.error = null
  if (!state.expandedSaved)
    for (const root of catalog.roots) state.expanded.add(folderKey(root.id, ''))
  catalogLoaded(catalog)
}

/** After a full or partial catalog arrives: settle edits, follow a new folder, show it. */
function catalogLoaded(catalog: Catalog): void {
  settleEdits(catalog)
  selectAwaitedRoot(catalog)
  // A folder remembered from last time that no longer exists would show an empty grid forever.
  if (
    catalog.roots.length > 0 &&
    !state.folder.startsWith('*') &&
    !findFolder(folderTree(), state.folder)
  ) {
    state.folder = ALL_KEY
    save(KEYS.folder, state.folder)
  }
  applyFilter(false)
}

async function refreshCatalog(force = false): Promise<void> {
  // A slow poll still running: skip this tick. Explicit refreshes always run and win.
  if (!force && refreshesInFlight > 0) return
  const run = ++refreshGeneration
  refreshesInFlight++
  try {
    await loadLatestCatalog(run, force)
  } catch (error) {
    if (run !== refreshGeneration) return
    // A read that fails while a catalog is already shown keeps it; the editor only loses the
    // library when there was none to begin with.
    if (state.catalog && state.catalog.updatedAt !== 0) {
      setStatus(`Couldn't refresh the library: ${(error as Error).message}`, 'error')
    } else {
      state.catalog = null
      state.error = (error as Error).message
      applyFilter(false)
    }
  } finally {
    refreshesInFlight--
  }
}

function useCatalogAt(path: string): void {
  state.catalogPath = path
  state.catalogMtime = null
  grid.scrollTop = 0
  void refreshCatalog(true)
}

function selectAwaitedRoot(catalog: Catalog): void {
  if (!state.awaitingRoot) return
  const root = catalog.roots.find(
    (r) => r.path && samePath(r.path, state.awaitingRoot as string, WINDOWS)
  )
  if (!root) return
  state.awaitingRoot = null
  openFolder(folderKey(root.id, ''), false)
}

// ── Engine: requests out, status in ─────────────────────────────────────────

let engineStartAt = 0

/** Starts the engine if it isn't running (at most every 20 s). */
async function ensureEngine(): Promise<void> {
  if (engineRunning(state.engine) || Date.now() - engineStartAt < 20_000) return
  engineStartAt = Date.now()
  await startEngine()
}

async function request(req: PanelRequest, label: string): Promise<string | null> {
  if (!state.catalogPath) {
    setStatus("Asset Library isn't set up yet. Choose your catalog in Settings.", 'error')
    return null
  }
  try {
    const id = await sendRequest(state.catalogPath, req)
    state.pending.set(id, { label, at: Date.now(), request: req })
    if (engineRunning(state.engine)) {
      setStatus(label)
    } else {
      setStatus(`${label} Starting the Asset Library engine…`)
      void ensureEngine()
    }
    return id
  } catch (error) {
    setStatus(`Couldn't send that to Asset Library: ${(error as Error).message}`, 'error')
    return null
  }
}

function undoEdit(req: PanelRequest): void {
  if (req.type === 'set-favorite') state.favoriteEdits.delete(req.id)
  if (req.type === 'add-tag' || req.type === 'remove-tag') state.tagEdits.delete(req.id)
  if (req.type === 'add-folder') state.awaitingRoot = null
  if (req.type === 'set-settings') state.loginEdit = null
  if (req.type === 'play-audio') state.playingId = null
}

let engineWasRunning = false

async function pollEngine(): Promise<void> {
  if (!state.catalogPath) return
  const status = await readEngineStatus(state.catalogPath)
  const running = engineRunning(status)
  const changed = status?.updatedAt !== state.engine?.updatedAt || running !== engineWasRunning
  engineWasRunning = running
  state.engine = status
  if (state.loginEdit !== null && status?.settings.startAtLogin === state.loginEdit)
    state.loginEdit = null
  // Outcomes of our requests.
  for (const result of status?.results ?? []) {
    const pending = state.pending.get(result.id)
    if (!pending) continue
    state.pending.delete(result.id)
    if (!result.ok) {
      undoEdit(pending.request)
      applyFilter(false)
    }
    if (pending.request.type === 'play-audio' && !result.ok) state.playingId = null
    if (pending.request.type === 'stop-audio') state.playingId = null
    setStatus(result.message, result.ok ? 'ok' : 'error')
  }
  // Requests nobody picked up.
  for (const [id, pending] of state.pending) {
    if (Date.now() - pending.at < REQUEST_TIMEOUT_MS || running) continue
    state.pending.delete(id)
    void removeRequest(state.catalogPath, id)
    undoEdit(pending.request)
    applyFilter(false)
    setStatus(
      "The Asset Library engine isn't running, so that didn't go through. Start it in Settings.",
      'error'
    )
  }
  if (changed) {
    if (state.tab === 'settings') renderSettings()
    renderFooter()
  }
}

// ── Organizing ──────────────────────────────────────────────────────────────

function toggleFavorite(asset: CatalogAsset): void {
  const favorite = !effective(asset).favorite
  state.favoriteEdits.set(asset.id, favorite)
  applyFilter(false)
  void request(
    { type: 'set-favorite', id: asset.id, favorite },
    favorite ? `Added ${asset.name} to Favorites.` : `Removed ${asset.name} from Favorites.`
  )
}

/** F on a selection: all become favorites, unless every one already is. */
function toggleFavorites(assets: CatalogAsset[]): void {
  if (assets.length <= 1) {
    if (assets[0]) toggleFavorite(assets[0])
    return
  }
  const favorite = !assets.every((asset) => effective(asset).favorite)
  for (const asset of assets) {
    if (effective(asset).favorite === favorite) continue
    state.favoriteEdits.set(asset.id, favorite)
    void request({ type: 'set-favorite', id: asset.id, favorite }, '')
  }
  applyFilter(false)
  setStatus(
    favorite
      ? `Added ${assets.length} assets to Favorites.`
      : `Removed ${assets.length} assets from Favorites.`,
    'ok'
  )
}

function addTag(asset: CatalogAsset, raw: string): void {
  const tag = raw.trim()
  if (!tag) return
  const current = effective(asset).tags
  const existing = current.find((t) => t.toLowerCase() === tag.toLowerCase())
  if (existing) {
    setStatus(`${asset.name} already has the tag “${existing}”.`)
    return
  }
  // Reuse the library's spelling of a tag that already exists elsewhere.
  const known = state.catalog?.tags.find((t) => t.toLowerCase() === tag.toLowerCase()) ?? tag
  state.tagEdits.set(asset.id, [...current, known])
  applyFilter(false)
  void request({ type: 'add-tag', id: asset.id, tag: known }, `Tagged ${asset.name} “${known}”.`)
}

/** Plays an audio asset through the engine (panels can't play sound); again to stop. */
function audition(asset: CatalogAsset): void {
  if (asset.kind !== 'audio') return
  if (state.playingId === asset.id) {
    state.playingId = null
    renderGrid()
    void request({ type: 'stop-audio' }, 'Stopped.')
    return
  }
  state.playingId = asset.id
  renderGrid()
  void request({ type: 'play-audio', id: asset.id }, `Playing ${asset.name}…`)
}

function removeTag(asset: CatalogAsset, tag: string): void {
  state.tagEdits.set(
    asset.id,
    effective(asset).tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
  )
  applyFilter(false)
  void request({ type: 'remove-tag', id: asset.id, tag }, `Removed the tag “${tag}”.`)
}

async function addFolder(): Promise<void> {
  try {
    const path = await pickFolder()
    if (!path) return
    state.awaitingRoot = path
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    await request({ type: 'add-folder', path }, `Adding ${name}…`)
  } catch (error) {
    setStatus(`Couldn't add that folder: ${(error as Error).message}`, 'error')
  }
}

/** Where an import goes: the selected library folder, or the engine's Imports folder. */
function importTarget(): { rootId?: number; folder?: string; label: string } {
  const node = state.view === 'folders' ? findFolder(folderTree(), state.folder) : null
  return node
    ? { rootId: node.rootId, folder: node.path, label: node.label }
    : { label: 'your Imports folder' }
}

async function importFiles(): Promise<void> {
  try {
    const files = await pickFiles()
    if (files.length === 0) return
    const target = importTarget()
    const count = files.length === 1 ? '1 file' : `${files.length} files`
    const req: PanelRequest =
      target.rootId === undefined
        ? { type: 'import-files', files }
        : { type: 'import-files', files, rootId: target.rootId, folder: target.folder ?? '' }
    await request(req, `Importing ${count} into ${target.label}…`)
  } catch (error) {
    setStatus(`Couldn't import: ${(error as Error).message}`, 'error')
  }
}

// ── Grid (virtualized: only visible rows are in the DOM) ────────────────────

interface Layout {
  columns: number
  tileWidth: number
  thumbHeight: number
  rowHeight: number
}

function layout(): Layout {
  const width = Math.max(0, grid.clientWidth - GAP * 2)
  // The slider sets the tile width you'd like; the nearest column count that fits wins.
  const columns = Math.max(1, Math.round((width + GAP) / (state.tileSize + GAP)))
  const tileWidth = Math.floor((width - GAP * (columns - 1)) / columns)
  const thumbHeight = Math.round((tileWidth * 9) / 16)
  return { columns, tileWidth, thumbHeight, rowHeight: thumbHeight + CAPTION + GAP }
}

function summary(asset: CatalogAsset): string {
  const parts: string[] = []
  if (asset.width && asset.height && asset.kind !== 'audio')
    parts.push(`${asset.width}×${asset.height}`)
  const duration = formatDuration(asset.durationMs)
  if (duration && asset.kind !== 'video') parts.push(duration)
  if (parts.length === 0) parts.push(asset.folder || asset.root)
  return parts.join(', ')
}

/** Everything a tile shows; when it changes the tile is rebuilt (a size change only resizes it). */
function tileKey(asset: CatalogAsset): string {
  return JSON.stringify([
    asset.name,
    asset.kind,
    asset.path,
    asset.root,
    asset.folder,
    asset.thumb,
    asset.wave,
    asset.sprite,
    asset.hasAlpha,
    asset.favorite,
    asset.durationMs,
    asset.width,
    asset.height
  ])
}

/** A tile's parts that depend on the thumbnail size, so a resize never rebuilds the tile. */
interface TileNode {
  node: HTMLElement
  key: string
  size: Layout
  resize(box: Layout): void
}

function buildTile(asset: CatalogAsset, box: Layout): TileNode {
  const tile = el('div', 'tile')
  tile.title = `${asset.name}\n${asset.root}${asset.folder ? `/${asset.folder}` : ''}`
  const size = { box }

  const thumb = el('div', `thumb${asset.hasAlpha ? ' alpha' : ''}`)
  const sized: HTMLElement[] = [tile, thumb]
  const stillPath = asset.kind === 'audio' ? asset.wave : asset.thumb
  if (stillPath) {
    const img = el('img', 'still')
    showLocalImage(img, stillPath, mimeFor(stillPath))
    thumb.append(img)
    sized.push(img)
  } else {
    thumb.append(el('div', 'placeholder', asset.name.split('.').pop()?.toUpperCase() ?? ''))
  }

  // Hover-scrub: slide the sprite strip so the frame under the cursor shows.
  let sprite: HTMLElement | null = null
  if ((asset.kind === 'video' || asset.kind === 'template') && asset.sprite) {
    const strip = el('img', 'sprite')
    sprite = strip
    strip.style.display = 'none'
    let loaded = false
    thumb.addEventListener('mousemove', (event) => {
      if (!loaded) {
        showLocalImage(strip, asset.sprite as string, mimeFor(asset.sprite as string))
        loaded = true
      }
      // Measure from the thumb itself: offsetX is relative to whichever child is under the
      // cursor, which is the sprite once it shows.
      const width = size.box.tileWidth
      const x = event.clientX - thumb.getBoundingClientRect().left
      const ratio = Math.min(0.999, Math.max(0, x / width))
      strip.style.left = `${-Math.floor(ratio * SPRITE_FRAMES) * width}px`
      strip.style.display = 'block'
    })
    thumb.addEventListener('mouseleave', () => (strip.style.display = 'none'))
    thumb.append(strip)
  }
  const resize = (next: Layout): void => {
    size.box = next
    for (const node of sized) node.style.width = `${next.tileWidth}px`
    thumb.style.height = `${next.thumbHeight}px`
    if (sized[2]) sized[2].style.height = `${next.thumbHeight}px`
    if (sprite) {
      sprite.style.width = `${next.tileWidth * SPRITE_FRAMES}px`
      sprite.style.height = `${next.thumbHeight}px`
    }
  }
  resize(box)

  // Audio plays through the engine: a play button on the tile (Space does the same).
  if (asset.kind === 'audio') {
    const play = el('span', 'play', state.playingId === asset.id ? '■' : '▶')
    play.title = 'Play (Space)'
    play.addEventListener('click', (event) => {
      event.stopPropagation()
      audition(asset)
    })
    play.addEventListener('dblclick', (event) => event.stopPropagation())
    thumb.append(play)
  }

  const duration =
    asset.kind === 'video' || asset.kind === 'audio' ? formatDuration(asset.durationMs) : null
  if (duration) {
    const badge = el('span', 'badge', duration)
    badge.style.right = '4px'
    badge.style.bottom = '4px'
    thumb.append(badge)
  }
  if (asset.hasAlpha) {
    const badge = el('span', 'badge alpha', 'Alpha')
    badge.style.left = '4px'
    badge.style.top = '4px'
    thumb.append(badge)
  }
  // Favorite star: always shown when on; on hover (or when selected) when off.
  const star = el('span', `star${asset.favorite ? ' on' : ''}`, asset.favorite ? '★' : '☆')
  star.title = asset.favorite ? 'Remove from Favorites (F)' : 'Add to Favorites (F)'
  star.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleFavorite(asset)
  })
  star.addEventListener('dblclick', (event) => event.stopPropagation())
  thumb.append(star)

  tile.append(thumb, el('div', 'name', asset.name), el('div', 'meta', summary(asset)))

  tile.addEventListener('click', (event) => select(asset, event))
  tile.addEventListener('dblclick', () => void placeSelection([asset]))
  makeDraggable(tile, asset)
  return { node: tile, key: tileKey(asset), size: box, resize }
}

/** Drag onto Premiere's timeline (Premiere 27+ only). */
function makeDraggable(node: HTMLElement, asset: CatalogAsset): void {
  if (!canDrag) return
  const contentType = dragContentType(asset.name)
  if (!contentType) return
  node.setAttribute('draggable', 'true')
  node.addEventListener('dragstart', (event) => {
    const payload = {
      version: '1.0.0',
      items: [{ name: asset.name, content_type: contentType, uri: fileUri(asset.path) }]
    }
    event.dataTransfer?.setData('text/plain', JSON.stringify(payload))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  })
}

/** Scrolls the grid so an asset's tile is in view. */
function scrollGridTo(id: string): void {
  const index = state.visible.findIndex((asset) => asset.id === id)
  if (index < 0) return
  const box = layout()
  const top = Math.floor(index / box.columns) * box.rowHeight
  if (top < grid.scrollTop || top + box.rowHeight > grid.scrollTop + grid.clientHeight)
    grid.scrollTop = Math.max(0, top - box.rowHeight)
  renderGrid()
}

/** Tiles currently in the DOM, by asset ID. Kept across renders so clicks, double-clicks and
 * loaded images survive scrolling, selection and catalog updates. */
const tiles = new Map<string, TileNode>()
const spacer = el('div')
spacer.style.position = 'relative'
let shownMessage: string | null = null

function clearTiles(): void {
  for (const entry of tiles.values()) entry.node.remove()
  tiles.clear()
}

interface Action {
  label: string
  run: () => void
  primary?: boolean
}

function renderMessage(title: string, text: string, actions: Action[] = []): void {
  const key = JSON.stringify([title, text, actions.map((action) => action.label)])
  if (shownMessage === key) return
  clearTiles()
  grid.textContent = ''
  shownMessage = key
  const box = el('div', 'message')
  box.append(el('div', 'title', title))
  if (text) box.append(el('div', '', text))
  const row = el('div', 'message-actions')
  for (const action of actions)
    row.append(button(action.label, action.primary ? 'primary' : '', action.run))
  box.append(row)
  grid.append(box)
}

function typeLabel(kind: KindFilter): string {
  return kind === 'image' ? 'images' : kind === 'all' ? 'assets' : `${kind}s`
}

function scopeName(): string {
  if (state.view === 'all' || state.folder === ALL_KEY) return 'your library'
  if (state.text && state.searchScope === 'all') return 'your library'
  if (state.folder === FAVORITES_KEY) return 'Favorites'
  if (state.folder === RECENT_KEY) return 'Recent'
  if (state.folder.startsWith(TAG_PREFIX)) return `“${state.folder.slice(TAG_PREFIX.length)}”`
  const node = findFolder(folderTree(), state.folder)
  return node?.label ?? 'this folder'
}

function renderEmpty(): void {
  const catalog = state.catalog as Catalog
  const indexing = (state.engine?.indexing.rootIds.length ?? 0) > 0 || state.awaitingRoot !== null
  if (catalog.roots.length === 0) {
    renderMessage(
      indexing ? 'Adding your folder…' : 'Add your first folder',
      indexing
        ? 'Assets show up here as Asset Library finds them.'
        : 'Pick a folder of footage, overlays, sound effects or templates. It stays where it is; nothing is moved.',
      indexing ? [] : [{ label: 'Add folder', run: () => void addFolder(), primary: true }]
    )
    return
  }
  if (state.text) {
    const actions: Action[] =
      state.view === 'folders' && state.folder !== ALL_KEY
        ? [{ label: 'Search all assets', run: () => openFolder(ALL_KEY, true) }]
        : []
    renderMessage(
      `Nothing in ${scopeName()} matches “${state.text}”`,
      'Try a shorter word, part of a folder name, or a tag.',
      actions
    )
    return
  }
  if (state.view === 'folders' && state.folder === FAVORITES_KEY) {
    renderMessage(
      'No favorites yet',
      'Click the ☆ on any asset, or select it and press F, to keep it here.'
    )
    return
  }
  if (state.folder === RECENT_KEY && state.view === 'folders') {
    renderMessage('Nothing placed yet', 'Assets you add to the timeline show up here, newest first.')
    return
  }
  if (state.favoritesOnly || state.kind !== 'all') {
    renderMessage(
      `No ${state.favoritesOnly ? 'favorites' : typeLabel(state.kind)} in ${scopeName()}`,
      state.favoritesOnly ? 'Click the ★ next to a file, or press F.' : '',
      [
        {
          label: 'Show everything',
          run: () => {
            state.kind = 'all'
            state.favoritesOnly = false
            applyFilter(true)
          }
        }
      ]
    )
    return
  }
  renderMessage(
    indexing ? 'Indexing…' : `Nothing in ${scopeName()} yet`,
    indexing
      ? 'Assets show up here as Asset Library finds them.'
      : 'Import files into it, or pick another folder.',
    indexing ? [] : [{ label: 'Import files', run: () => void importFiles(), primary: true }]
  )
}

function renderGrid(remeasured = false): void {
  if (state.error) {
    renderMessage('Your library isn’t connected yet', state.error, [
      { label: 'Try again', run: () => void refreshCatalog(true), primary: true },
      { label: 'Choose catalog…', run: () => void chooseCatalogFile() }
    ])
    return
  }
  if (!state.catalog) {
    renderMessage('Loading your library…', '')
    return
  }
  if (state.visible.length === 0) {
    renderEmpty()
    return
  }

  if (shownMessage !== null || spacer.parentNode !== grid) {
    grid.textContent = ''
    grid.append(spacer)
    shownMessage = null
  }
  const box = layout()
  const measuredWidth = grid.clientWidth
  const rows = Math.ceil(state.visible.length / box.columns)
  const first = Math.max(0, Math.floor(grid.scrollTop / box.rowHeight) - 2)
  const last = Math.min(
    rows - 1,
    Math.ceil((grid.scrollTop + grid.clientHeight) / box.rowHeight) + 2
  )
  spacer.style.height = `${rows * box.rowHeight + GAP}px`

  const shown = new Set<string>()
  for (let row = first; row <= last; row++) {
    for (let column = 0; column < box.columns; column++) {
      const asset = state.visible[row * box.columns + column]
      if (!asset) break
      const key = tileKey(asset) + (state.playingId === asset.id ? ':playing' : '')
      let entry = tiles.get(asset.id)
      if (!entry || entry.key !== key) {
        entry?.node.remove()
        entry = buildTile(asset, box)
        entry.key = key
        tiles.set(asset.id, entry)
        spacer.append(entry.node)
      } else if (entry.size !== box) {
        entry.resize(box)
        entry.size = box
      }
      shown.add(asset.id)
      const tile = entry.node
      if (state.selectedIds.has(asset.id)) tile.classList.add('selected')
      else tile.classList.remove('selected')
      tile.style.left = `${GAP + column * (box.tileWidth + GAP)}px`
      tile.style.top = `${GAP + row * box.rowHeight}px`
    }
  }
  for (const [id, entry] of tiles) {
    if (shown.has(id)) continue
    entry.node.remove()
    tiles.delete(id)
  }

  // Content can make a scrollbar appear (Windows), which narrows the grid: lay out again once.
  if (!remeasured && grid.clientWidth !== measuredWidth) renderGrid(true)
}

let scrollFrame = 0
grid.addEventListener('scroll', () => {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    renderGrid()
  })
})

// ── Folder tree (folders and files, virtualized) ────────────────────────────

function treeVisible(): boolean {
  if (state.view !== 'folders') return false
  if (state.treePref === 'shown') return true
  if (state.treePref === 'hidden') return false
  return app.clientWidth === 0 || app.clientWidth >= NARROW_PX
}

/** The tree's width as a fixed flex size (a plain width on a flex item left it unclickable). */
function setTreeWidth(width: number): void {
  const value = `${width}px`
  if (treePane.style.width !== value) treePane.style.width = value
}

function treeWidth(): number {
  const width = app.clientWidth || 380
  const max = Math.max(160, width - 160)
  const wanted = state.treeWidth ?? Math.round(width * 0.42)
  return Math.min(max, Math.max(150, wanted))
}

function openFolder(key: string, resetSearch: boolean): void {
  state.folder = key
  save(KEYS.folder, key)
  // Opening a folder reveals it in the tree.
  for (const node of folderTrail(folderTree(), key).slice(0, -1)) state.expanded.add(node.key)
  save(KEYS.expanded, [...state.expanded])
  if (resetSearch && state.text) {
    state.text = ''
    search.value = ''
  }
  applyFilter(true)
}

function toggleExpanded(key: string): void {
  if (state.expanded.has(key)) state.expanded.delete(key)
  else state.expanded.add(key)
  state.expandedSaved = true
  save(KEYS.expanded, [...state.expanded])
  renderTree()
}

interface TreeItem {
  type: 'special' | 'section' | 'folder' | 'file'
  key: string
  depth: number
  label: string
  count?: number
  icon?: string
  expandable: boolean
  offline?: boolean
  asset?: CatalogAsset
}

const TAGS_SECTION = '*tags'

const byName = (a: CatalogAsset, b: CatalogAsset): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** Every row the tree would show with the current folders opened, top to bottom. */
function treeItems(): TreeItem[] {
  const catalog = state.catalog
  if (!catalog) return []
  const all = catalog.assets.map(effective)
  const items: TreeItem[] = [
    {
      type: 'special',
      key: ALL_KEY,
      depth: 0,
      label: 'All assets',
      count: all.length,
      expandable: false
    },
    {
      type: 'special',
      key: FAVORITES_KEY,
      depth: 0,
      label: 'Favorites',
      icon: '★',
      count: all.filter((a) => a.favorite).length,
      expandable: false
    },
    {
      type: 'special',
      key: RECENT_KEY,
      depth: 0,
      label: 'Recent',
      icon: '↺',
      count: state.recent.length,
      expandable: false
    }
  ]
  // Files directly in each folder, by folder key.
  const files = new Map<string, CatalogAsset[]>()
  for (const asset of all) {
    const rootId = asset.rootId ?? catalog.roots.find((r) => r.label === asset.root)?.id
    if (rootId === undefined) continue
    const key = folderKey(rootId, asset.folder)
    const list = files.get(key)
    if (list) list.push(asset)
    else files.set(key, [asset])
  }
  const walk = (node: FolderNode, depth: number): void => {
    for (const child of node.children) {
      const childFiles = files.get(child.key)?.length ?? 0
      items.push({
        type: 'folder',
        key: child.key,
        depth,
        label: child.label,
        count: child.count,
        expandable: child.children.length > 0 || childFiles > 0,
        offline: !child.online
      })
      if (state.expanded.has(child.key)) walk(child, depth + 1)
    }
    for (const asset of (files.get(node.key) ?? []).sort(byName))
      items.push({
        type: 'file',
        key: `file:${asset.id}`,
        depth,
        label: asset.name,
        expandable: false,
        asset
      })
  }
  for (const root of folderTree()) {
    items.push({
      type: 'section',
      key: root.key,
      depth: 0,
      label: root.label,
      count: root.count,
      expandable: true,
      offline: !root.online
    })
    if (state.expanded.has(root.key)) walk(root, 1)
  }
  const tags = new Map<string, number>()
  for (const asset of all) for (const tag of asset.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
  if (tags.size > 0) {
    items.push({ type: 'section', key: TAGS_SECTION, depth: 0, label: 'Tags', expandable: true })
    if (state.expanded.has(TAGS_SECTION))
      for (const [tag, count] of [...tags].sort((a, b) => a[0].localeCompare(b[0])))
        items.push({
          type: 'special',
          key: tagKey(tag),
          depth: 1,
          label: tag,
          icon: '#',
          count,
          expandable: false
        })
  }
  return items
}

/** Clicking a file in the tree: show its folder in the grid, with the file selected. */
function selectFromTree(asset: CatalogAsset): void {
  const rootId =
    asset.rootId ?? state.catalog?.roots.find((r) => r.label === asset.root)?.id ?? null
  if (rootId !== null) {
    const key = folderKey(rootId, asset.folder)
    if (state.folder !== key) {
      state.folder = key
      save(KEYS.folder, key)
      if (state.text) {
        state.text = ''
        search.value = ''
      }
    }
  }
  // Filters that would hide the file are lifted, so what was clicked is what shows.
  if (state.favoritesOnly && !effective(asset).favorite) state.favoritesOnly = false
  if (state.kind !== 'all' && asset.kind !== state.kind) state.kind = 'all'
  state.selectedId = asset.id
  state.selectedIds = new Set([asset.id])
  state.anchorId = asset.id
  state.editingTag = false
  state.status = null
  applyFilter(false, false)
  scrollGridTo(asset.id)
}

function typeIcon(asset: CatalogAsset): string {
  return asset.kind === 'image' ? 'image' : asset.kind
}

const COUNT_WIDTH = 34

/** 22845 → "22.8k", so counts fit a narrow tree. */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
const GUTTER = 16

/** Places a part of a tree row at an exact spot (no flexbox inside rows; see the toolbar note). */
function part(node: HTMLElement, left: number, width: number): HTMLElement {
  node.style.left = `${left}px`
  node.style.width = `${Math.max(0, width)}px`
  return node
}

function treeRowNode(item: TreeItem, index: number, width: number): HTMLElement {
  const row = el(
    'div',
    `tree-row ${item.type}${isSelectedRow(item) ? ' selected' : ''}${item.offline ? ' offline' : ''}`
  )
  row.dataset['index'] = String(index)
  row.style.top = `${index * TREE_ROW}px`
  row.style.width = `${width}px`
  row.title = item.offline ? `${item.label} isn't connected` : item.label

  // Favorite star in the gutter, for files.
  if (item.type === 'file' && item.asset) {
    const asset = item.asset
    const gutter = part(el('span', `gutter${asset.favorite ? ' on' : ''}`, '★'), 0, GUTTER)
    gutter.title = asset.favorite ? 'Remove from Favorites' : 'Add to Favorites'
    gutter.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      toggleFavorite(asset)
    })
    gutter.addEventListener('dblclick', (event) => event.stopPropagation())
    row.append(gutter)
  }
  let x = GUTTER + item.depth * 12
  if (item.expandable) {
    const caret = part(el('span', 'caret', state.expanded.has(item.key) ? '⌄' : '›'), x, 14)
    caret.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      toggleExpanded(item.key)
    })
    row.append(caret)
  }
  x += 14
  if (item.type === 'folder') row.append(part(el('span', 'type-icon folder'), x, 16))
  else if (item.type === 'file' && item.asset)
    row.append(part(el('span', `type-icon ${typeIcon(item.asset)}`), x, 16))
  else if (item.icon) row.append(part(el('span', 'tree-icon', item.icon), x, 16))
  if (item.type !== 'section' || item.icon) x += 20
  const hasCount = item.type !== 'file' && (item.offline || item.count !== undefined)
  row.append(
    part(el('span', 'tree-label', item.label), x, width - x - (hasCount ? COUNT_WIDTH + 8 : 6))
  )
  if (hasCount)
    row.append(
      part(
        el('span', 'tree-count', item.offline ? 'offline' : formatCount(item.count ?? 0)),
        width - COUNT_WIDTH - 4,
        COUNT_WIDTH
      )
    )

  if (item.type === 'file' && item.asset) {
    const asset = item.asset
    row.addEventListener('mousedown', () => selectFromTree(asset))
    row.addEventListener('dblclick', () => void placeSelection([asset]))
    makeDraggable(row, asset)
  } else if (item.key === TAGS_SECTION) {
    row.addEventListener('mousedown', () => toggleExpanded(item.key))
  } else {
    row.addEventListener('mousedown', () => {
      // A click opens the folder and shows what's inside; the caret folds it.
      if (item.expandable && !state.expanded.has(item.key)) {
        state.expanded.add(item.key)
        state.expandedSaved = true
        save(KEYS.expanded, [...state.expanded])
      }
      openFolder(item.key, false)
    })
  }
  return row
}

let treeCache: TreeItem[] = []
/**
 * Rows currently in the tree, by item key. Kept across renders, like the grid's tiles: Premiere's
 * panel runtime asks for many re-layouts in a row, and a row rebuilt between two of them is never
 * clickable (it's gone before the click lands).
 */
const treeRows = new Map<string, { node: HTMLElement; key: string }>()

function isSelectedRow(item: TreeItem): boolean {
  return item.type === 'file'
    ? state.selectedIds.has(item.asset?.id ?? '')
    : state.folder === item.key
}

/** Everything a row shows; a change rebuilds it. Selection is toggled in place. */
function rowKey(item: TreeItem, width: number): string {
  return JSON.stringify([
    item.type,
    item.label,
    item.count,
    item.icon,
    item.expandable,
    item.offline,
    item.depth,
    state.expanded.has(item.key),
    item.asset?.favorite,
    width
  ])
}

/** Writes a style only when it changes: every write is layout work for the panel runtime. */
function setStyle(node: HTMLElement, property: 'width' | 'height' | 'top', value: string): void {
  if (node.style[property] !== value) node.style[property] = value
}

function renderTree(rebuild = true): void {
  const visible = treeVisible()
  show(treePane, visible)
  show(splitter, visible)
  if (!visible) return
  setTreeWidth(treeWidth())
  if (rebuild) treeCache = treeItems()
  // Only the rows in view exist, each placed at an exact position and size.
  const scrolled = Math.max(0, treeScroll.scrollTop - TREE_HEAD)
  const first = Math.max(0, Math.floor(scrolled / TREE_ROW) - 6)
  const last = Math.min(
    treeCache.length - 1,
    Math.ceil((scrolled + (treeScroll.clientHeight || 600)) / TREE_ROW) + 6
  )
  const width = Math.max(120, (treeScroll.clientWidth || treeWidth()) - 2)
  setStyle(treeSpacer, 'height', `${treeCache.length * TREE_ROW}px`)
  setStyle(treeSpacer, 'width', `${width}px`)
  const shown = new Set<string>()
  let built = 0
  for (let i = first; i <= last; i++) {
    const item = treeCache[i]
    if (!item) continue
    const key = rowKey(item, width)
    let entry = treeRows.get(item.key)
    if (!entry || entry.key !== key) {
      entry?.node.remove()
      entry = { node: treeRowNode(item, i, width), key }
      treeRows.set(item.key, entry)
      treeSpacer.append(entry.node)
      built++
    }
    shown.add(item.key)
    setStyle(entry.node, 'top', `${i * TREE_ROW}px`)
    if (isSelectedRow(item)) entry.node.classList.add('selected')
    else entry.node.classList.remove('selected')
  }
  for (const [key, entry] of treeRows) {
    if (shown.has(key)) continue
    entry.node.remove()
    treeRows.delete(key)
  }
  if (PANEL_DIAG && built > 0) note(`tree rows ${first}-${last}: ${built} built, ${treeRows.size} kept`)
}

let treeFrame = 0
let treeScrolls = 0
treeScroll.addEventListener('scroll', () => {
  if (PANEL_DIAG && ++treeScrolls % 20 === 1) note(`tree scroll events: ${treeScrolls}`)
  if (treeFrame) return
  treeFrame = requestAnimationFrame(() => {
    treeFrame = 0
    renderTree(false)
  })
})

// Dragging the divider resizes the tree.
let dragStart: { x: number; width: number } | null = null
splitter.addEventListener('mousedown', (event) => {
  dragStart = { x: event.clientX, width: treeWidth() }
  event.preventDefault()
})
let dragFrame = 0
document.addEventListener('mousemove', (event) => {
  if (!dragStart) return
  // The button went up outside the panel: the drag is over.
  if (event.buttons === 0) {
    endDrag()
    return
  }
  state.treeWidth = dragStart.width + event.clientX - dragStart.x
  setTreeWidth(treeWidth())
  if (dragFrame) return
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0
    renderGrid()
  })
})
function endDrag(): void {
  if (!dragStart) return
  dragStart = null
  state.treeWidth = treeWidth()
  save(KEYS.treeWidth, state.treeWidth)
  // Lay out again once the panes have their new sizes.
  requestAnimationFrame(() => renderAll())
}
document.addEventListener('mouseup', endDrag)
window.addEventListener('blur', endDrag)

// ── Toolbar ─────────────────────────────────────────────────────────────────

function parentKey(key: string): string | null {
  if (key === ALL_KEY || key.startsWith('*')) return null
  const slash = key.indexOf('/')
  const path = key.slice(slash + 1)
  if (path === '') return ALL_KEY
  const cut = path.lastIndexOf('/')
  return `${key.slice(0, slash + 1)}${cut === -1 ? '' : path.slice(0, cut)}`
}

function renderToolbar(): void {
  show(toolbar, state.view === 'folders')
  if (state.view !== 'folders') return
  treeToggle.textContent = '☰'
  if (treeVisible()) treeToggle.classList.add('active')
  else treeToggle.classList.remove('active')
  treeToggle.title = treeVisible() ? 'Hide folders' : 'Show folders'
  const up = parentKey(state.folder)
  setDisabled(upButton, up === null)
  let label = 'All assets'
  if (state.folder === FAVORITES_KEY) label = 'Favorites'
  else if (state.folder === RECENT_KEY) label = 'Recent'
  else if (state.folder.startsWith(TAG_PREFIX)) label = `# ${state.folder.slice(TAG_PREFIX.length)}`
  else if (state.folder !== ALL_KEY) {
    const trail = folderTrail(folderTree(), state.folder)
    if (trail.length > 0) label = trail.map((node) => node.label).join(' › ')
  }
  crumbs.textContent = label
  crumbs.title = label
  renderFolderSelect(label)
  if (typeSelect.value !== state.kind) typeSelect.value = state.kind
  importButton.title = `Copy files into ${importTarget().label} and add them to the library`
}

let folderOptionsFor = ''

/** Fills the folder menu (all folders, indented, plus Favorites and tags). */
function renderFolderSelect(label: string): void {
  const catalog = state.catalog
  const signature = `${catalog?.updatedAt ?? 0}:${state.favoriteEdits.size}:${state.tagEdits.size}:${state.recent.length}`
  if (catalog && signature !== folderOptionsFor) {
    folderOptionsFor = signature
    folderSelect.textContent = ''
    const add = (key: string, text: string): void => {
      const option = el('option', '', text)
      option.value = key
      folderSelect.append(option)
    }
    const all = catalog.assets.map(effective)
    add(ALL_KEY, `All assets (${all.length.toLocaleString()})`)
    add(FAVORITES_KEY, `★ Favorites (${all.filter((a) => a.favorite).length.toLocaleString()})`)
    add(RECENT_KEY, `↺ Recent (${state.recent.length})`)
    const walk = (node: FolderNode): void => {
      add(node.key, `${'\u2003'.repeat(node.depth)}${node.label} (${node.count.toLocaleString()})`)
      for (const child of node.children) walk(child)
    }
    for (const root of folderTree()) walk(root)
    const tags = [...new Set(all.flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b))
    for (const tag of tags) add(tagKey(tag), `# ${tag}`)
  }
  folderSelect.value = state.folder
  folderSelect.title = label
}

folderSelect.addEventListener('change', () => {
  if (folderSelect.value && folderSelect.value !== state.folder)
    openFolder(folderSelect.value, false)
})

treeToggle.addEventListener('click', () => {
  state.treePref = treeVisible() ? 'hidden' : 'shown'
  save(KEYS.tree, state.treePref)
  renderAll()
})
upButton.addEventListener('click', () => {
  const up = parentKey(state.folder)
  if (up !== null) openFolder(up, false)
})
importButton.addEventListener('click', () => void importFiles())
addFolderButton.addEventListener('click', () => void addFolder())
typeSelect.addEventListener('change', () => {
  const value = typeSelect.value
  state.kind =
    value === 'video' || value === 'audio' || value === 'image' || value === 'template'
      ? value
      : 'all'
  applyFilter(true)
})
scopeSelect.addEventListener('change', () => {
  state.searchScope = scopeSelect.value === 'all' ? 'all' : 'folder'
  save(KEYS.scope, state.searchScope)
  if (state.text) applyFilter(true)
})

// ── Settings ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function section(title: string): HTMLElement {
  const box = el('div', 'settings-section')
  box.append(el('div', 'settings-title', title))
  settingsPane.append(box)
  return box
}

function chooseCatalogFile(): Promise<void> {
  return chooseCatalog()
    .then((path) => {
      if (path) useCatalogAt(path)
    })
    .catch((error: Error) => setStatus(`Couldn't open that file: ${error.message}`, 'error'))
}

/** What the Settings tab is built from; a change rebuilds it, otherwise only texts update. */
let settingsKey = ''
const settingsTexts = new Map<string, HTMLElement>()

function loginOn(): boolean {
  return state.loginEdit ?? state.engine?.settings.startAtLogin !== false
}

function checkRow(label: string, on: boolean, toggle: () => void): HTMLElement {
  const row = el('div', 'check-row')
  const box = el('span', `checkbox${on ? ' on' : ''}`, on ? '✓' : '')
  row.append(box, el('span', '', label))
  row.addEventListener('click', toggle)
  return row
}

function engineWords(): string {
  const engine = state.engine
  if (!engineRunning(engine)) return "Not running. Thumbnails, imports and edits wait until it's started."
  if ((engine?.indexing.rootIds.length ?? 0) > 0)
    return `Indexing ${(engine?.indexing.filesSeen ?? 0).toLocaleString()} files…`
  if (engine && engine.pendingMedia > 0)
    return `Making previews (${engine.pendingMedia.toLocaleString()} to go)`
  return 'Running · Up to date'
}

/**
 * Settings are rebuilt only when their shape changes (folders, engine up or down, a confirm);
 * every heartbeat just updates the numbers, so a button under the mouse is never replaced.
 */
function renderSettings(): void {
  const engine = state.engine
  const running = engineRunning(engine)
  const roots = state.catalog?.roots ?? []
  const updatesOn = engine?.settings.checkForUpdates !== false
  const key = JSON.stringify([
    running,
    roots.map((root) => [root.id, root.label, root.online, root.path]),
    state.confirmRemove,
    state.catalogPath,
    engine?.importsFolder,
    loginOn(),
    updatesOn,
    engine?.update?.version
  ])
  if (key !== settingsKey) {
    settingsKey = key
    settingsPane.textContent = ''
    settingsTexts.clear()

    const engineBox = section('Engine')
    const line = el('div', 'settings-line')
    const words = el('span', 'settings-text')
    settingsTexts.set('engine', words)
    line.append(el('span', `dot${running ? ' on' : ''}`), words)
    engineBox.append(line)
    if (!running)
      engineBox.append(
        button('Start engine', 'primary', () => {
          engineStartAt = 0
          void ensureEngine()
          setStatus('Starting the Asset Library engine…')
        })
      )
    if (engine?.update) {
      const update = engine.update
      const row = el('div', 'settings-line')
      row.append(
        el('span', 'settings-text', `Version ${update.version} is available.`),
        button('Get it', 'small', () => void openLink(update.url))
      )
      engineBox.append(row)
    }

    const general = section('General')
    general.append(
      checkRow('Start the engine when I log in', loginOn(), () => {
        const next = !loginOn()
        state.loginEdit = next
        renderSettings()
        void request(
          { type: 'set-settings', startAtLogin: next },
          next ? 'The engine will start when you log in.' : "The engine won't start at login."
        )
      }),
      checkRow('Check for new versions once a day', updatesOn, () => {
        void request(
          { type: 'set-settings', checkForUpdates: !updatesOn },
          updatesOn ? 'Update checks are off.' : 'Asset Library will check for new versions daily.'
        )
      })
    )

    const folders = section('Library folders')
    if (roots.length === 0) folders.append(el('div', 'settings-hint', 'No folders yet.'))
    for (const root of roots) {
      const row = el('div', 'folder-row')
      const text = el('div', 'folder-text')
      const meta = el('div', 'folder-meta')
      settingsTexts.set(`root:${root.id}`, meta)
      text.append(el('div', 'folder-name', root.label), meta)
      const confirming = state.confirmRemove === root.id
      row.append(
        text,
        button(
          'Rescan',
          'small',
          () => void request({ type: 'rescan', rootId: root.id }, `Rescanning ${root.label}…`)
        ),
        button(confirming ? 'Confirm' : 'Remove', confirming ? 'small danger' : 'small', () => {
          if (!confirming) {
            state.confirmRemove = root.id
            renderSettings()
            setTimeout(() => {
              if (state.confirmRemove === root.id) {
                state.confirmRemove = null
                renderSettings()
              }
            }, 4000)
            return
          }
          state.confirmRemove = null
          void request(
            { type: 'remove-folder', rootId: root.id },
            `Removing ${root.label} from the library. Your files stay where they are.`
          )
        })
      )
      folders.append(row)
    }
    const folderActions = el('div', 'settings-actions')
    folderActions.append(
      button('Add folder', 'primary', () => void addFolder()),
      button('Rescan all', '', () => void request({ type: 'rescan' }, 'Rescanning all folders…'))
    )
    folders.append(folderActions)
    if (engine?.importsFolder)
      folders.append(
        el('div', 'settings-hint', `Imports without a folder go to ${engine.importsFolder}`)
      )

    const previews = section('Previews')
    const cache = el('div', 'settings-line')
    const cacheText = el('span', 'settings-text')
    settingsTexts.set('cache', cacheText)
    cache.append(
      cacheText,
      button(
        'Clear',
        'small',
        () =>
          void request({ type: 'clear-cache' }, 'Clearing previews. They rebuild in the background.')
      )
    )
    previews.append(cache)

    const advanced = section('Advanced')
    const catalogLine = el('div', 'settings-line')
    catalogLine.append(
      el('span', 'settings-text muted', state.catalogPath ?? 'Catalog not found'),
      button('Change…', 'small', () => void chooseCatalogFile())
    )
    advanced.append(catalogLine)

    const about = section('About')
    const aboutText = el('div', 'settings-hint')
    settingsTexts.set('about', aboutText)
    about.append(aboutText)
  }

  // The numbers that change with every heartbeat.
  settingsTexts.get('engine')!.textContent = engineWords()
  const counts = new Map<number, number>()
  for (const node of folderTree()) counts.set(node.rootId, node.count)
  for (const root of roots) {
    const meta = settingsTexts.get(`root:${root.id}`)
    if (meta)
      meta.textContent = root.online
        ? `${(counts.get(root.id) ?? 0).toLocaleString()} assets${root.path ? ` · ${root.path}` : ''}`
        : `Not connected${root.path ? ` · ${root.path}` : ''}`
  }
  settingsTexts.get('cache')!.textContent =
    `Thumbnails and previews: ${engine ? formatBytes(engine.cacheBytes) : '—'}`
  settingsTexts.get('about')!.textContent =
    `Asset Library panel ${PANEL_VERSION}${engine ? ` · engine ${engine.version}` : ''} · by Saxenas Creation`
}

/** Opens a web page in the browser (only our own release pages are ever linked). */
async function openLink(url: string): Promise<void> {
  try {
    await uxp.shell?.openExternal(url, 'Open the release page')
  } catch (error) {
    setStatus(`Couldn't open the page: ${(error as Error).message}`, 'error')
  }
}

// ── Selection and placing on the timeline ───────────────────────────────────

function selected(): CatalogAsset | null {
  return state.visible.find((asset) => asset.id === state.selectedId) ?? null
}

/** Every selected asset, in the grid's order. */
function selectedAssets(): CatalogAsset[] {
  return state.visible.filter((asset) => state.selectedIds.has(asset.id))
}

/** A click on a tile: plain selects it, shift extends to it, ctrl/cmd adds or removes it. */
function select(asset: CatalogAsset, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): void {
  if (state.selectedId !== asset.id) state.editingTag = false
  const order = state.visible.map((a) => a.id)
  if (event?.shiftKey) {
    state.selectedIds = new Set(rangeBetween(order, state.anchorId, asset.id))
  } else if (event?.metaKey || event?.ctrlKey) {
    if (state.selectedIds.has(asset.id) && state.selectedIds.size > 1)
      state.selectedIds.delete(asset.id)
    else state.selectedIds.add(asset.id)
    state.anchorId = asset.id
  } else {
    state.selectedIds = new Set([asset.id])
    state.anchorId = asset.id
  }
  state.selectedId = asset.id
  state.status = null
  grid.focus()
  renderGrid()
  renderTree(false)
  renderFooter()
}

/** Moves the selection in the grid by `step` tiles (a row is `columns` tiles). */
function moveSelection(step: number, extend: boolean): void {
  if (state.visible.length === 0) return
  const index = state.visible.findIndex((asset) => asset.id === state.selectedId)
  const next = index === -1 ? 0 : Math.min(state.visible.length - 1, Math.max(0, index + step))
  const asset = state.visible[next]
  if (!asset) return
  select(asset, extend ? { shiftKey: true, metaKey: false, ctrlKey: false } : undefined)
  scrollGridTo(asset.id)
}

/** Puts the assets on the timeline one after another, starting at the playhead. */
async function placeSelection(assets: CatalogAsset[]): Promise<void> {
  if (state.busy || assets.length === 0) return
  state.busy = true
  const first = assets[0] as CatalogAsset
  setStatus(assets.length === 1 ? `Adding ${first.name}…` : `Adding ${assets.length} assets…`)
  try {
    const message = await placeAtPlayhead(assets, state.options)
    for (const asset of assets) state.recent = recordRecent(state.recent, asset.id, RECENT_MAX)
    save(KEYS.recent, state.recent)
    setStatus(message, 'ok')
    if (state.folder === RECENT_KEY) applyFilter(false)
    else renderTree(false)
  } catch (error) {
    setStatus(
      error instanceof UserError
        ? error.message
        : `Something went wrong: ${(error as Error).message}`,
      'error'
    )
  } finally {
    state.busy = false
    renderFooter()
  }
}

function trackSelect(
  label: string,
  value: number,
  onChange: (value: number) => void
): HTMLSelectElement {
  const select = el('select')
  select.setAttribute('aria-label', label)
  for (let i = 0; i < 8; i++) {
    const option = el('option', '', `${label[0]}${i + 1}`)
    option.value = String(i)
    if (i === value) option.selected = true
    select.append(option)
  }
  select.addEventListener('change', () => onChange(Number(select.value)))
  return select
}

const modeSelect = el('select')
const placeButton = el('div', 'button primary', 'Add at playhead')

// The footer controls are built once; renders only update them, so open menus stay open.
function buildControls(): void {
  const choiceRow = el('div', 'control-row choices')
  const actionRow = el('div', 'control-row actions')
  controls.append(choiceRow, actionRow)
  const saveOptions = (): void => save(KEYS.options, state.options)
  choiceRow.append(
    trackSelect('Video track', state.options.videoTrack, (value) => {
      state.options.videoTrack = value
      saveOptions()
    }),
    trackSelect('Audio track', state.options.audioTrack, (value) => {
      state.options.audioTrack = value
      saveOptions()
    })
  )
  modeSelect.setAttribute('aria-label', 'Edit type')
  for (const [value, label] of [
    ['overwrite', 'Overwrite'],
    ['insert', 'Insert']
  ] as const) {
    const option = el('option', '', label)
    option.value = value
    if (state.options.mode === value) option.selected = true
    modeSelect.append(option)
  }
  modeSelect.addEventListener('change', () => {
    state.options.mode = modeSelect.value === 'insert' ? 'insert' : 'overwrite'
    saveOptions()
  })
  placeButton.addEventListener('click', () => {
    if (!placeButton.classList.contains('disabled')) void placeSelection(selectedAssets())
  })
  choiceRow.append(modeSelect)
  actionRow.append(placeButton)
}

let shownTags: string | null = null

/** The selection's tags, with remove (×) and an inline "+ Tag" editor. */
function renderTagRow(asset: CatalogAsset | null): void {
  const key = asset ? JSON.stringify([asset.id, asset.tags, state.editingTag]) : null
  if (key === shownTags) return
  shownTags = key
  tagRow.textContent = ''
  show(tagRow, asset !== null && state.tab === 'library')
  if (!asset) return
  for (const tag of asset.tags) {
    const chip = el('span', 'tag')
    chip.append(el('span', '', tag))
    const remove = el('span', 'tag-x', '×')
    remove.title = `Remove “${tag}”`
    remove.addEventListener('click', () => removeTag(asset, tag))
    chip.append(remove)
    tagRow.append(chip)
  }
  if (state.editingTag) {
    const input = el('input', 'tag-input')
    input.placeholder = 'New tag'
    input.setAttribute('aria-label', 'New tag')
    const finish = (commit: boolean): void => {
      const value = input.value
      state.editingTag = false
      if (commit) addTag(asset, value)
      else renderFooter()
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') finish(false)
      event.stopPropagation()
    })
    input.addEventListener('blur', () => {
      if (state.editingTag) finish(input.value.trim().length > 0)
    })
    tagRow.append(input)
    setTimeout(() => input.focus(), 0)
  } else {
    tagRow.append(
      button('+ Tag', 'small', () => {
        state.editingTag = true
        renderFooter()
      })
    )
  }
}

/** The most previews waiting since the engine started on them, so progress can be shown. */
let mediaTotal = 0

function renderFooter(): void {
  const asset = state.tab === 'library' ? selected() : null
  const count = state.tab === 'library' ? state.selectedIds.size : 0
  renderTagRow(count === 1 ? asset : null)
  show(controls, state.tab === 'library')
  setDisabled(placeButton, count === 0 || state.busy)
  placeButton.textContent = count > 1 ? `Add ${count} at playhead` : 'Add at playhead'

  const engine = state.engine
  const indexing = (engine?.indexing.rootIds.length ?? 0) > 0
  const pending = engine?.pendingMedia ?? 0
  mediaTotal = pending === 0 ? 0 : Math.max(mediaTotal, pending)
  let working = ''
  if (indexing) working = `Indexing… ${(engine?.indexing.filesSeen ?? 0).toLocaleString()} files found`
  else if (pending > 0) working = `Making previews · ${pending.toLocaleString()} to go`
  show(progressBar, state.tab === 'library' && pending > 0 && !state.status)
  progressFill.style.width = `${mediaTotal > 0 ? Math.round(((mediaTotal - pending) / mediaTotal) * 100) : 0}%`

  const hint = state.status
    ? state.status
    : {
        text:
          count > 1
            ? `${count} selected · Enter adds them in order, F favorites them`
            : asset
              ? canDrag
                ? 'Double-click or drag onto the timeline. F adds to Favorites.'
                : 'Double-click to add at the playhead. F adds to Favorites.'
              : working
                ? working
                : state.catalog
                  ? `${state.visible.length.toLocaleString()} assets`
                  : '',
        tone: 'info' as const
      }
  statusLine.className = `status${hint.tone === 'info' ? '' : ` ${hint.tone}`}`
  statusLine.textContent = hint.text
  statusLine.title = hint.text
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderHeader(): void {
  if (state.tab === 'library') browseTab.classList.add('active')
  else browseTab.classList.remove('active')
  if (state.tab === 'settings') settingsTab.classList.add('active')
  else settingsTab.classList.remove('active')
  if (state.favoritesOnly) favoritesToggle.classList.add('on')
  else favoritesToggle.classList.remove('on')
  show(scopeSelect, state.view === 'folders' && state.folder !== ALL_KEY)
}

browseTab.addEventListener('click', () => {
  state.tab = 'library'
  renderAll()
})
settingsTab.addEventListener('click', () => {
  state.tab = 'settings'
  renderAll()
})
favoritesToggle.addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly
  applyFilter(true)
})
sizeSlider.addEventListener('input', () => {
  state.tileSize = Number(sizeSlider.value) || TILE_SIZES.default
  save(KEYS.tileSize, state.tileSize)
  renderGrid()
})

let renderAlls = 0
function renderAll(rebuildTree = true): void {
  if (PANEL_DIAG) note(`renderAll #${++renderAlls} rebuildTree=${rebuildTree}`)
  const library = state.tab === 'library'
  show(header, library)
  show(body, library)
  show(settingsPane, !library)
  renderHeader()
  if (library) {
    renderTree(rebuildTree)
    renderToolbar()
    renderGrid()
  } else {
    renderSettings()
  }
  renderFooter()
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
search.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    state.text = search.value
    applyFilter(true)
  }, 120)
})

const TYPING_TAGS = ['input', 'select', 'textarea', 'button']

function clearSearch(): void {
  if (!state.text && !search.value) return
  state.text = ''
  search.value = ''
  applyFilter(true)
}

// Keyboard: arrows move the selection (shift extends), Enter adds, F favorites, Space plays a
// sound, Esc clears, / finds.
document.addEventListener('keydown', (event) => {
  if (event.repeat) return
  if (event.key === 'Escape' && document.activeElement === search) {
    clearSearch()
    grid.focus()
    return
  }
  // Keys in a field, menu or button belong to that control.
  const target = event.target as HTMLElement | null
  if (target?.tagName && TYPING_TAGS.includes(target.tagName.toLowerCase())) return
  if (document.activeElement === search || state.tab !== 'library') return
  if (event.key === '/') {
    event.preventDefault()
    search.focus()
    return
  }
  if (event.key === 'Escape') {
    if (state.text) clearSearch()
    else if (state.selectedIds.size > 0) {
      state.selectedIds = new Set()
      state.selectedId = null
      state.editingTag = false
      renderAll(false)
    }
    return
  }
  const columns = state.visible.length > 0 ? layout().columns : 1
  const moves: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns
  }
  const step = moves[event.key]
  if (step !== undefined) {
    event.preventDefault()
    moveSelection(step, event.shiftKey)
    return
  }
  const assets = selectedAssets()
  if (assets.length === 0) return
  if (event.key === 'Enter') void placeSelection(assets)
  else if (event.key === 'f' || event.key === 'F') toggleFavorites(assets)
  else if (event.key === ' ') {
    const asset = selected()
    if (asset?.kind === 'audio') {
      event.preventDefault()
      audition(asset)
    }
  }
})

let resizeFrame = 0
let lastSize = ''
window.addEventListener('resize', () => {
  if (PANEL_DIAG) note(`resize app ${app.clientWidth}x${app.clientHeight}`)
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    // Premiere's panel runtime reports a resize for layout work the panel itself did, which would
    // loop forever (re-layout → resize → re-layout…). Only a real change of size needs a new layout.
    const size = `${app.clientWidth}x${app.clientHeight}`
    if (size === lastSize && size !== '0x0') return
    lastSize = size
    renderAll()
  })
})

// ── Start ───────────────────────────────────────────────────────────────────

if (PANEL_DIAG)
  installDiagnostics({
    catalogPath: () => state.catalogPath,
    body,
    treePane,
    treeHead,
    treeSpacer,
    buildRow: (label, index) =>
      treeRowNode(
        { type: 'folder', key: `diag:${label}`, depth: 1, label, count: 7, expandable: true },
        index,
        200
      ),
    rebuildMainPane: () => {
      folderOptionsFor = ''
      renderToolbar()
      renderGrid()
    },
    splitter,
    mainPane,
    toolbar,
    grid,
    status: (text) => setStatus(text)
  })
buildControls()
renderAll()
void refreshCatalog(true).then(async () => {
  await pollEngine()
  // The panel is the app: make sure the engine is running behind it.
  if (!engineRunning(state.engine)) void ensureEngine()
})
// The engine rewrites the catalog whenever the library changes; pick that up.
setInterval(() => void refreshCatalog(false), POLL_MS)
setInterval(() => void pollEngine(), ENGINE_POLL_MS)

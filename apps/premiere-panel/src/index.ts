// Asset Library panel for Premiere Pro: the whole product. Browse the library like a file
// manager, preview, organize (favorites, tags, folders), import, and put assets on the timeline.
// A background engine does the indexing and thumbnails; the panel talks to it through files.
import type { Catalog, CatalogAsset } from '@catalog/types'
import { SPRITE_FRAMES } from '@catalog/types'
import { filterAssets, formatDuration, type CatalogFilter } from '@catalog/filter'
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
  loadCatalog,
  locateCatalog,
  mimeFor,
  modifiedTime,
  pickFiles,
  pickFolder,
  showLocalImage
} from './files'
import { detectWindows, storage } from './host'
import { insertAtPlayhead, UserError, type InsertOptions } from './premiere'
import { dragContentType, DRAG_MIN_MAJOR, fileUri, hostMajor, samePath } from './paths'
import { engineRunning, readEngineStatus, sendRequest, startEngine } from './engine'

const uxp = require('uxp')
const canDrag = hostMajor(uxp.host.version) >= DRAG_MIN_MAJOR
const WINDOWS = detectWindows()
const PANEL_VERSION = '0.3.1'

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
  tileSize: 'assetLibrary.tileSize'
}

type KindFilter = NonNullable<CatalogFilter['kind']> | 'favorites'
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
  kind: KindFilter
  visible: CatalogAsset[]
  selectedId: string | null
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
  kind: 'all',
  visible: [],
  selectedId: null,
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
  node.style.display = visible ? '' : 'none'
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
favoritesToggle.title = 'Show only favorites'
const search = el('input', 'search')
search.placeholder = 'Search names, folders and tags'
search.setAttribute('aria-label', 'Search assets')
header.append(favoritesToggle, search)

// Library: the folder tree (folders and files), a divider you can drag, and the grid.
const body = el('div', 'body')
const treePane = el('div', 'tree')
const treeHead = el('div', 'tree-head')
const treeScroll = el('div', 'tree-scroll')
const treeSpacer = el('div')
treeSpacer.style.position = 'relative'
treeScroll.append(treeSpacer)
treePane.append(treeHead, treeScroll)
const splitter = el('div', 'splitter', '⋮')
splitter.title = 'Drag to resize'
const mainPane = el('div', 'main')
const toolbar = el('div', 'toolbar')
const grid = el('div', 'grid')
mainPane.append(toolbar, grid)
body.append(treePane, splitter, mainPane)

// Settings.
const settingsPane = el('div', 'settings')

// Footer: tags of the selection, placement choices, the main action; then size and status.
const footer = el('div', 'footer')
const tagRow = el('div', 'tag-row')
const controls = el('div', 'controls')
const bottomRow = el('div', 'bottom-row')
const sizeSlider = el('input', 'size-slider')
sizeSlider.type = 'range'
sizeSlider.min = String(TILE_SIZES.min)
sizeSlider.max = String(TILE_SIZES.max)
sizeSlider.step = '4'
sizeSlider.value = String(state.tileSize)
sizeSlider.title = 'Thumbnail size'
sizeSlider.setAttribute('aria-label', 'Thumbnail size')
const statusLine = el('div', 'status')
bottomRow.append(sizeSlider, statusLine)
footer.append(tagRow, controls, bottomRow)

app.append(topbar, header, body, settingsPane, footer)

function setStatus(text: string, tone: Tone = 'info'): void {
  state.status = { text, tone }
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

function scopeAssets(): CatalogAsset[] {
  const catalog = state.catalog
  if (!catalog) return []
  const all = catalog.assets.map(effective)
  return state.view === 'folders' ? all.filter((a) => inFolder(a, catalog, state.folder)) : all
}

/**
 * Recomputes the visible assets. `resetScroll` is for the editor's own changes (search, filter,
 * folder); background catalog updates keep the scroll position.
 */
function applyFilter(resetScroll: boolean): void {
  state.visible = filterAssets(scopeAssets(), {
    text: state.text,
    kind: state.kind === 'favorites' ? 'all' : state.kind,
    favoritesOnly: state.kind === 'favorites'
  })
  if (state.selectedId && !state.visible.some((a) => a.id === state.selectedId)) {
    state.selectedId = null
    state.editingTag = false
  }
  if (resetScroll) grid.scrollTop = 0
  renderAll()
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
  if (!force && state.catalog && catalog.updatedAt === state.catalog.updatedAt) return
  state.catalog = catalog
  state.error = null
  if (!state.expandedSaved)
    for (const root of catalog.roots) state.expanded.add(folderKey(root.id, ''))
  settleEdits(catalog)
  selectAwaitedRoot(catalog)
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
    state.catalog = null
    state.error = (error as Error).message
    applyFilter(false)
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
}

async function pollEngine(): Promise<void> {
  if (!state.catalogPath) return
  const status = await readEngineStatus(state.catalogPath)
  const changed = status?.updatedAt !== state.engine?.updatedAt
  state.engine = status
  // Outcomes of our requests.
  for (const result of status?.results ?? []) {
    const pending = state.pending.get(result.id)
    if (!pending) continue
    state.pending.delete(result.id)
    if (!result.ok) {
      undoEdit(pending.request)
      applyFilter(false)
    }
    setStatus(result.message, result.ok ? 'ok' : 'error')
  }
  // Requests nobody picked up.
  for (const [id, pending] of state.pending) {
    if (Date.now() - pending.at < REQUEST_TIMEOUT_MS || engineRunning(status)) continue
    state.pending.delete(id)
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

function addTag(asset: CatalogAsset, raw: string): void {
  const tag = raw.trim()
  if (!tag) return
  const current = effective(asset).tags
  if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return
  state.tagEdits.set(asset.id, [...current, tag])
  applyFilter(false)
  void request({ type: 'add-tag', id: asset.id, tag }, `Tagged ${asset.name} “${tag}”.`)
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
  const node =
    state.view === 'folders' && state.catalog
      ? findFolder(buildFolderTree(state.catalog), state.folder)
      : null
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

/** Everything a tile shows; when it changes (or the tile size does) the tile is rebuilt. */
function tileKey(asset: CatalogAsset, box: Layout): string {
  return JSON.stringify([
    box.tileWidth,
    box.thumbHeight,
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

function buildTile(asset: CatalogAsset, box: Layout): HTMLElement {
  const tile = el('div', 'tile')
  tile.style.width = `${box.tileWidth}px`
  tile.title = `${asset.name}\n${asset.root}${asset.folder ? `/${asset.folder}` : ''}`

  const thumb = el('div', `thumb${asset.hasAlpha ? ' alpha' : ''}`)
  thumb.style.width = `${box.tileWidth}px`
  thumb.style.height = `${box.thumbHeight}px`
  const stillPath = asset.kind === 'audio' ? asset.wave : asset.thumb
  if (stillPath) {
    const img = el('img', 'still')
    img.style.width = `${box.tileWidth}px`
    img.style.height = `${box.thumbHeight}px`
    showLocalImage(img, stillPath, mimeFor(stillPath))
    thumb.append(img)
  } else {
    thumb.append(el('div', 'placeholder', asset.name.split('.').pop()?.toUpperCase() ?? ''))
  }

  // Hover-scrub: slide the sprite strip so the frame under the cursor shows.
  if ((asset.kind === 'video' || asset.kind === 'template') && asset.sprite) {
    const sprite = el('img', 'sprite')
    sprite.style.width = `${box.tileWidth * SPRITE_FRAMES}px`
    sprite.style.height = `${box.thumbHeight}px`
    sprite.style.display = 'none'
    let loaded = false
    thumb.addEventListener('mousemove', (event) => {
      if (!loaded) {
        showLocalImage(sprite, asset.sprite as string, mimeFor(asset.sprite as string))
        loaded = true
      }
      // Measure from the thumb itself: offsetX is relative to whichever child is under the
      // cursor, which is the sprite once it shows.
      const x = event.clientX - thumb.getBoundingClientRect().left
      const ratio = Math.min(0.999, Math.max(0, x / box.tileWidth))
      sprite.style.left = `${-Math.floor(ratio * SPRITE_FRAMES) * box.tileWidth}px`
      sprite.style.display = 'block'
    })
    thumb.addEventListener('mouseleave', () => (sprite.style.display = 'none'))
    thumb.append(sprite)
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

  tile.addEventListener('click', () => select(asset))
  tile.addEventListener('dblclick', () => void place(asset))
  makeDraggable(tile, asset)
  return tile
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
const tiles = new Map<string, { node: HTMLElement; key: string }>()
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

function scopeName(): string {
  if (state.view === 'all' || state.folder === ALL_KEY) return 'your library'
  if (state.folder === FAVORITES_KEY) return 'Favorites'
  if (state.folder.startsWith(TAG_PREFIX)) return `“${state.folder.slice(TAG_PREFIX.length)}”`
  const node = state.catalog ? findFolder(buildFolderTree(state.catalog), state.folder) : null
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
  if (state.kind === 'favorites') {
    renderMessage(`No favorites in ${scopeName()}`, 'Click the ★ next to a file, or press F.', [
      {
        label: 'Show everything',
        run: () => {
          state.kind = 'all'
          applyFilter(true)
        }
      }
    ])
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
      const key = tileKey(asset, box)
      let entry = tiles.get(asset.id)
      if (!entry || entry.key !== key) {
        entry?.node.remove()
        entry = { node: buildTile(asset, box), key }
        tiles.set(asset.id, entry)
        spacer.append(entry.node)
      }
      shown.add(asset.id)
      const tile = entry.node
      if (asset.id === state.selectedId) tile.classList.add('selected')
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
  if (state.catalog) {
    for (const node of folderTrail(buildFolderTree(state.catalog), key).slice(0, -1))
      state.expanded.add(node.key)
    save(KEYS.expanded, [...state.expanded])
  }
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
  for (const root of buildFolderTree({ ...catalog, assets: all })) {
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
  state.selectedId = asset.id
  state.editingTag = false
  state.status = null
  applyFilter(false)
  scrollGridTo(asset.id)
}

function typeIcon(asset: CatalogAsset): string {
  return asset.kind === 'image' ? 'image' : asset.kind
}

function treeRowNode(item: TreeItem, index: number): HTMLElement {
  const selectedRow =
    item.type === 'file' ? item.asset?.id === state.selectedId : state.folder === item.key
  const row = el(
    'div',
    `tree-row ${item.type}${selectedRow ? ' selected' : ''}${item.offline ? ' offline' : ''}`
  )
  row.style.top = `${index * TREE_ROW}px`
  // An explicit width: Premiere's panel runtime draws left/right-stretched rows but doesn't
  // let them receive clicks.
  row.style.width = `${treeRowWidth}px`
  // Favorite star in the gutter, for files.
  const gutter = el('span', 'gutter')
  if (item.type === 'file' && item.asset) {
    const asset = item.asset
    gutter.textContent = '★'
    if (asset.favorite) gutter.classList.add('on')
    gutter.title = asset.favorite ? 'Remove from Favorites' : 'Add to Favorites'
    gutter.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleFavorite(asset)
    })
    gutter.addEventListener('dblclick', (event) => event.stopPropagation())
  }
  row.append(gutter)
  const indent = el('span', 'indent')
  indent.style.width = `${item.depth * 14}px`
  row.append(indent)
  const caret = el(
    'span',
    'caret',
    item.expandable ? (state.expanded.has(item.key) ? '⌄' : '›') : ''
  )
  if (item.expandable) {
    caret.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleExpanded(item.key)
    })
  }
  row.append(caret)
  if (item.type === 'folder') row.append(el('span', 'type-icon folder'))
  else if (item.type === 'file' && item.asset)
    row.append(el('span', `type-icon ${typeIcon(item.asset)}`))
  else if (item.icon) row.append(el('span', 'tree-icon', item.icon))
  row.append(el('span', 'tree-label', item.label))
  if (item.type !== 'file')
    row.append(
      el(
        'span',
        'tree-count',
        item.offline ? 'offline' : item.count === undefined ? '' : String(item.count)
      )
    )
  row.title = item.offline ? `${item.label} isn't connected` : item.label

  if (item.type === 'file' && item.asset) {
    const asset = item.asset
    row.addEventListener('click', () => selectFromTree(asset))
    row.addEventListener('dblclick', () => void place(asset))
    makeDraggable(row, asset)
  } else if (item.key === TAGS_SECTION) {
    row.addEventListener('click', () => toggleExpanded(item.key))
  } else {
    row.addEventListener('click', () => {
      if (item.expandable && !state.expanded.has(item.key)) {
        state.expanded.add(item.key)
        state.expandedSaved = true
        save(KEYS.expanded, [...state.expanded])
      }
      openFolder(item.key, false)
    })
    if (item.expandable) row.addEventListener('dblclick', () => toggleExpanded(item.key))
  }
  return row
}

let treeCache: TreeItem[] = []
let treeRowWidth = 200

function renderTree(rebuild = true): void {
  const visible = treeVisible()
  show(treePane, visible)
  show(splitter, visible)
  if (!visible) return
  treePane.style.width = `${treeWidth()}px`
  treeRowWidth = treeScroll.clientWidth || treeWidth() - 10
  if (rebuild) {
    treeHead.textContent = ''
    treeHead.append(
      el('span', 'tree-title', 'Library'),
      button('+ Folder', 'small', () => void addFolder(), 'Add a folder to your library')
    )
    treeCache = treeItems()
  }
  treeSpacer.style.height = `${treeCache.length * TREE_ROW}px`
  const first = Math.max(0, Math.floor(treeScroll.scrollTop / TREE_ROW) - 6)
  const last = Math.min(
    treeCache.length - 1,
    Math.ceil((treeScroll.scrollTop + (treeScroll.clientHeight || 600)) / TREE_ROW) + 6
  )
  treeSpacer.textContent = ''
  for (let i = first; i <= last; i++) {
    const item = treeCache[i]
    if (item) treeSpacer.append(treeRowNode(item, i))
  }
}

let treeFrame = 0
treeScroll.addEventListener('scroll', () => {
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
document.addEventListener('mousemove', (event) => {
  if (!dragStart) return
  state.treeWidth = dragStart.width + event.clientX - dragStart.x
  treePane.style.width = `${treeWidth()}px`
  renderGrid()
})
document.addEventListener('mouseup', () => {
  if (!dragStart) return
  dragStart = null
  state.treeWidth = treeWidth()
  save(KEYS.treeWidth, state.treeWidth)
  // Lay out again once the panes have their new sizes.
  requestAnimationFrame(() => renderAll())
})

// ── Toolbar ─────────────────────────────────────────────────────────────────

function renderToolbar(): void {
  show(toolbar, state.view === 'folders')
  if (state.view !== 'folders') return
  toolbar.textContent = ''
  const toggle = el('div', 'icon-button', treeVisible() ? '⟨' : '☰')
  toggle.title = treeVisible() ? 'Hide folders' : 'Show folders'
  toggle.addEventListener('click', () => {
    state.treePref = treeVisible() ? 'hidden' : 'shown'
    save(KEYS.tree, state.treePref)
    renderAll()
  })
  const crumbs = el('div', 'crumbs')
  const add = (label: string, key: string | null): void => {
    if (crumbs.childNodes.length > 0) crumbs.append(el('span', 'crumb-sep', '›'))
    const crumb = el('span', key ? 'crumb link' : 'crumb', label)
    if (key) crumb.addEventListener('click', () => openFolder(key, false))
    crumbs.append(crumb)
  }
  if (state.folder === ALL_KEY) add('All assets', null)
  else if (state.folder === FAVORITES_KEY) add('Favorites', null)
  else if (state.folder.startsWith(TAG_PREFIX))
    add(`# ${state.folder.slice(TAG_PREFIX.length)}`, null)
  else if (state.catalog) {
    const trail = folderTrail(buildFolderTree(state.catalog), state.folder)
    trail.forEach((node, i) => add(node.label, i === trail.length - 1 ? null : node.key))
    if (trail.length === 0) add('All assets', null)
  }
  const target = importTarget()
  toolbar.append(
    toggle,
    crumbs,
    button(
      'Import',
      '',
      () => void importFiles(),
      `Copy files into ${target.label} and add them to the library`
    )
  )
}

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

function renderSettings(): void {
  settingsPane.textContent = ''
  const engine = state.engine
  const running = engineRunning(engine)

  const engineBox = section('Engine')
  const line = el('div', 'settings-line')
  const dot = el('span', `dot${running ? ' on' : ''}`)
  const indexingCount = engine?.indexing.rootIds.length ?? 0
  const words = !running
    ? "Not running. Thumbnails, imports and edits wait until it's started."
    : indexingCount > 0
      ? `Indexing ${(engine?.indexing.filesSeen ?? 0).toLocaleString()} files…`
      : engine && engine.pendingMedia > 0
        ? `Making previews (${engine.pendingMedia.toLocaleString()} to go)`
        : 'Running · Up to date'
  line.append(dot, el('span', 'settings-text', words))
  engineBox.append(line)
  if (!running)
    engineBox.append(
      button('Start engine', 'primary', () => {
        engineStartAt = 0
        void ensureEngine()
        setStatus('Starting the Asset Library engine…')
      })
    )

  const folders = section('Library folders')
  const roots = state.catalog?.roots ?? []
  const counts = new Map<number, number>()
  if (state.catalog)
    for (const node of buildFolderTree(state.catalog)) counts.set(node.rootId, node.count)
  if (roots.length === 0) folders.append(el('div', 'settings-hint', 'No folders yet.'))
  for (const root of roots) {
    const row = el('div', 'folder-row')
    const text = el('div', 'folder-text')
    text.append(
      el('div', 'folder-name', root.label),
      el(
        'div',
        'folder-meta',
        root.online
          ? `${(counts.get(root.id) ?? 0).toLocaleString()} assets${root.path ? ` · ${root.path}` : ''}`
          : `Not connected${root.path ? ` · ${root.path}` : ''}`
      )
    )
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

  const general = section('General')
  const login = el('div', 'check-row')
  const box = el('span', `checkbox${engine?.settings.startAtLogin !== false ? ' on' : ''}`)
  box.textContent = engine?.settings.startAtLogin !== false ? '✓' : ''
  login.append(box, el('span', '', 'Start the engine when I log in'))
  login.addEventListener('click', () => {
    const next = !(engine?.settings.startAtLogin !== false)
    void request(
      { type: 'set-settings', startAtLogin: next },
      next ? 'The engine will start when you log in.' : "The engine won't start at login."
    )
  })
  general.append(login)
  const cache = el('div', 'settings-line')
  cache.append(
    el(
      'span',
      'settings-text',
      `Thumbnails and previews: ${engine ? formatBytes(engine.cacheBytes) : '—'}`
    ),
    button(
      'Clear',
      'small',
      () =>
        void request({ type: 'clear-cache' }, 'Clearing previews. They rebuild in the background.')
    )
  )
  general.append(cache)
  const catalogLine = el('div', 'settings-line')
  catalogLine.append(
    el('span', 'settings-text muted', state.catalogPath ?? 'Catalog not found'),
    button('Change…', 'small', () => void chooseCatalogFile())
  )
  general.append(catalogLine)

  const about = section('About')
  about.append(
    el(
      'div',
      'settings-hint',
      `Asset Library panel ${PANEL_VERSION}${engine ? ` · engine ${engine.version}` : ''} · by Saxenas Creation`
    )
  )
}

// ── Selection and placing on the timeline ───────────────────────────────────

function selected(): CatalogAsset | null {
  return state.visible.find((asset) => asset.id === state.selectedId) ?? null
}

function select(asset: CatalogAsset): void {
  if (state.selectedId !== asset.id) state.editingTag = false
  state.selectedId = asset.id
  state.status = null
  renderGrid()
  renderTree(false)
  renderFooter()
}

async function place(asset: CatalogAsset): Promise<void> {
  if (state.busy) return
  state.busy = true
  setStatus(`Adding ${asset.name}…`)
  try {
    setStatus(await insertAtPlayhead(asset, state.options), 'ok')
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
    const asset = selected()
    if (asset && !placeButton.classList.contains('disabled')) void place(asset)
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

function renderFooter(): void {
  const asset = state.tab === 'library' ? selected() : null
  renderTagRow(asset)
  show(controls, state.tab === 'library')
  show(sizeSlider, state.tab === 'library')
  setDisabled(placeButton, !asset || state.busy)

  const indexing = (state.engine?.indexing.rootIds.length ?? 0) > 0
  const hint = state.status
    ? state.status
    : {
        text: asset
          ? canDrag
            ? 'Double-click or drag onto the timeline. F adds to Favorites.'
            : 'Double-click to add at the playhead. F adds to Favorites.'
          : state.catalog
            ? `${state.visible.length.toLocaleString()} assets${indexing ? ' · Indexing…' : ''}`
            : '',
        tone: 'info' as const
      }
  statusLine.className = `status${hint.tone === 'info' ? '' : ` ${hint.tone}`}`
  statusLine.textContent = hint.text
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderHeader(): void {
  if (state.tab === 'library') browseTab.classList.add('active')
  else browseTab.classList.remove('active')
  if (state.tab === 'settings') settingsTab.classList.add('active')
  else settingsTab.classList.remove('active')
  if (state.kind === 'favorites') favoritesToggle.classList.add('on')
  else favoritesToggle.classList.remove('on')
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
  state.kind = state.kind === 'favorites' ? 'all' : 'favorites'
  applyFilter(true)
})
sizeSlider.addEventListener('input', () => {
  state.tileSize = Number(sizeSlider.value) || TILE_SIZES.default
  save(KEYS.tileSize, state.tileSize)
  renderGrid()
})

function renderAll(): void {
  const library = state.tab === 'library'
  show(header, library)
  show(body, library)
  show(settingsPane, !library)
  renderHeader()
  if (library) {
    renderTree()
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

document.addEventListener('keydown', (event) => {
  if (event.repeat) return
  // Keys in a field, menu or button belong to that control.
  const target = event.target as HTMLElement | null
  if (target?.tagName && TYPING_TAGS.includes(target.tagName.toLowerCase())) return
  if (document.activeElement === search || state.tab !== 'library') return
  const asset = selected()
  if (!asset) return
  if (event.key === 'Enter') void place(asset)
  else if (event.key === 'f' || event.key === 'F') toggleFavorite(asset)
})

let resizeFrame = 0
window.addEventListener('resize', () => {
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    renderAll()
  })
})

// ── Start ───────────────────────────────────────────────────────────────────

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

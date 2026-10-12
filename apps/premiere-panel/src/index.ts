// Asset Library panel for Premiere Pro: browse the library the desktop app indexed, preview,
// and put assets on the timeline at the playhead.
import type { Catalog, CatalogAsset } from '@catalog/types'
import { SPRITE_FRAMES } from '@catalog/types'
import { filterAssets, formatDuration, type CatalogFilter } from '@catalog/filter'
import {
  chooseCatalog,
  loadCatalog,
  locateCatalog,
  mimeFor,
  modifiedTime,
  showLocalImage
} from './files'
import { storage } from './host'
import { insertAtPlayhead, importOnly, UserError, type InsertOptions } from './premiere'
import { dragContentType, DRAG_MIN_MAJOR, fileUri, fileUrl, hostMajor } from './paths'

const uxp = require('uxp')
const canDrag = hostMajor(uxp.host.version) >= DRAG_MIN_MAJOR

const TILE_MIN = 132
const GAP = 8
const CAPTION = 34
const POLL_MS = 3000
const OPTIONS_KEY = 'assetLibrary.insertOptions'

type KindFilter = NonNullable<CatalogFilter['kind']> | 'favorites'

interface State {
  catalogPath: string | null
  catalog: Catalog | null
  catalogMtime: number | null
  error: string | null
  text: string
  kind: KindFilter
  visible: CatalogAsset[]
  selectedId: string | null
  status: { text: string; tone: 'ok' | 'error' | 'info' } | null
  options: InsertOptions
  busy: boolean
}

function loadOptions(): InsertOptions {
  try {
    const saved = JSON.parse(storage.get(OPTIONS_KEY) ?? 'null') as InsertOptions | null
    if (saved && typeof saved.videoTrack === 'number') return saved
  } catch {
    // ignore bad saved options
  }
  return { videoTrack: 1, audioTrack: 1, mode: 'overwrite' }
}

const state: State = {
  catalogPath: null,
  catalog: null,
  catalogMtime: null,
  error: null,
  text: '',
  kind: 'all',
  visible: [],
  selectedId: null,
  status: null,
  options: loadOptions(),
  busy: false
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

const app = document.getElementById('app') as HTMLElement
const header = el('div', 'header')
const search = el('input', 'search')
search.placeholder = 'Search names, folders and tags'
search.setAttribute('aria-label', 'Search assets')
const chips = el('div', 'chips')
header.append(search, chips)
const grid = el('div', 'grid')
const footer = el('div', 'footer')
app.append(header, grid, footer)

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' },
  { id: 'template', label: 'Templates' },
  { id: 'favorites', label: 'Favorites' }
]

function setStatus(text: string, tone: 'ok' | 'error' | 'info' = 'info'): void {
  state.status = { text, tone }
  renderFooter()
}

// ── Data ────────────────────────────────────────────────────────────────────

/**
 * Recomputes the visible assets. `resetScroll` is for the editor's own search/filter changes;
 * background catalog updates keep the scroll position.
 */
function applyFilter(resetScroll: boolean): void {
  const catalog = state.catalog
  state.visible = catalog
    ? filterAssets(catalog.assets, {
        text: state.text,
        kind: state.kind === 'favorites' ? 'all' : state.kind,
        favoritesOnly: state.kind === 'favorites'
      })
    : []
  if (state.selectedId && !state.visible.some((a) => a.id === state.selectedId))
    state.selectedId = null
  if (resetScroll) grid.scrollTop = 0
  renderGrid()
  renderFooter()
}

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
    renderGrid()
    return
  }
  const mtime = await modifiedTime(path)
  if (stale(path)) return
  if (!force && mtime !== null && mtime === state.catalogMtime) return
  const catalog = await loadCatalog(path)
  if (stale(path)) return
  // Remember the time even when nothing changed, so the next poll doesn't parse it again.
  state.catalogMtime = mtime
  if (!force && state.catalog && catalog.updatedAt === state.catalog.updatedAt) return
  state.catalog = catalog
  state.error = null
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

// ── Grid (virtualized: only visible rows are in the DOM) ────────────────────

interface Layout {
  columns: number
  tileWidth: number
  thumbHeight: number
  rowHeight: number
}

function layout(): Layout {
  const width = Math.max(0, grid.clientWidth - GAP * 2)
  const columns = Math.max(1, Math.floor((width + GAP) / (TILE_MIN + GAP)))
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
  tile.title = `${asset.name}\n${asset.root}/${asset.folder}`

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
  if (asset.kind === 'video' && asset.sprite) {
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
  if (asset.favorite) {
    const badge = el('span', 'badge fav', '★')
    badge.style.right = '4px'
    badge.style.top = '4px'
    thumb.append(badge)
  }
  tile.append(thumb, el('div', 'name', asset.name), el('div', 'meta', summary(asset)))

  tile.addEventListener('click', () => select(asset))
  tile.addEventListener('dblclick', () => void place(asset))
  if (canDrag) {
    const contentType = dragContentType(asset.name)
    if (contentType) {
      tile.setAttribute('draggable', 'true')
      tile.addEventListener('dragstart', (event) => {
        const payload = {
          version: '1.0.0',
          items: [{ name: asset.name, content_type: contentType, uri: fileUri(asset.path) }]
        }
        event.dataTransfer?.setData('text/plain', JSON.stringify(payload))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
      })
    }
  }
  return tile
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

function renderMessage(
  title: string,
  body: string,
  actions: { label: string; run: () => void }[] = []
): void {
  const key = JSON.stringify([title, body, actions.map((action) => action.label)])
  if (shownMessage === key) return
  clearTiles()
  grid.textContent = ''
  shownMessage = key
  const box = el('div', 'message')
  box.append(el('div', 'title', title), el('div', '', body))
  const row = el('div', 'controls')
  row.style.justifyContent = 'center'
  row.style.marginTop = '12px'
  for (const action of actions) {
    const button = el('div', 'button', action.label)
    button.addEventListener('click', action.run)
    row.append(button)
  }
  box.append(row)
  grid.append(box)
}

function renderGrid(remeasured = false): void {
  if (state.error) {
    renderMessage('Your library isn’t connected yet', state.error, [
      { label: 'Try again', run: () => void refreshCatalog(true) },
      {
        label: 'Choose catalog…',
        run: () =>
          void chooseCatalog()
            .then((path) => {
              if (path) useCatalogAt(path)
            })
            .catch((error: Error) =>
              setStatus(`Couldn't open that file: ${error.message}`, 'error')
            )
      }
    ])
    return
  }
  if (!state.catalog) {
    renderMessage('Loading your library…', '')
    return
  }
  if (state.visible.length === 0) {
    renderMessage(
      state.text ? `Nothing matches “${state.text}”` : 'Nothing here yet',
      state.text
        ? 'Try a shorter word, part of a folder name, or a tag.'
        : 'Add folders in the Asset Library app. They show up here automatically.'
    )
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
window.addEventListener('resize', () => renderGrid())

// ── Selection, preview and placing on the timeline ──────────────────────────

function selected(): CatalogAsset | null {
  return state.visible.find((asset) => asset.id === state.selectedId) ?? null
}

function select(asset: CatalogAsset): void {
  state.selectedId = asset.id
  state.status = null
  renderGrid()
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

async function importSelected(asset: CatalogAsset): Promise<void> {
  if (state.busy) return
  state.busy = true
  try {
    setStatus(await importOnly(asset), 'ok')
  } catch (error) {
    setStatus(
      error instanceof UserError ? error.message : `Import failed: ${(error as Error).message}`,
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

function saveOptions(): void {
  storage.set(OPTIONS_KEY, JSON.stringify(state.options))
}

// The footer is built once; renders only update it, so open menus stay open and the preview
// keeps playing. The selection row is rebuilt only when the selected asset changes.
const selectionRow = el('div', 'selection')
const controls = el('div', 'controls')
const statusLine = el('div', 'status')
footer.append(selectionRow, controls, statusLine)
let shownSelection: string | null = null

function previewImage(path: string): HTMLImageElement {
  const img = el('img')
  img.style.width = '96px'
  img.style.height = '54px'
  showLocalImage(img, path, mimeFor(path))
  return img
}

function videoPreview(asset: CatalogAsset, src: string, preview: HTMLElement): void {
  const video = el('video')
  video.setAttribute('src', fileUrl(src))
  video.setAttribute('autoplay', '')
  video.setAttribute('loop', '')
  video.setAttribute('muted', '')
  video.muted = true
  video.style.width = '96px'
  video.style.height = '54px'
  video.addEventListener('error', () => {
    preview.textContent = ''
    if (asset.thumb) preview.append(previewImage(asset.thumb))
  })
  preview.append(video)
}

/** Audio never starts on its own: the waveform shows, and a click plays or pauses it. */
function audioPreview(asset: CatalogAsset, src: string, preview: HTMLElement): void {
  const audio = el('video')
  audio.setAttribute('src', fileUrl(src))
  audio.setAttribute('preload', 'metadata')
  audio.style.width = '96px'
  audio.style.height = '54px'
  preview.append(audio)
  if (asset.wave) {
    const wave = previewImage(asset.wave)
    wave.className = 'cover'
    preview.append(wave)
  }
  const toggle = el('span', 'badge play', '▶')
  toggle.style.left = '4px'
  toggle.style.bottom = '4px'
  preview.append(toggle)
  preview.title = 'Click to play or pause'
  preview.classList.add('playable')
  let playing = false
  const show = (now: boolean): void => {
    playing = now
    toggle.textContent = now ? '❚❚' : '▶'
  }
  audio.addEventListener('play', () => show(true))
  audio.addEventListener('pause', () => show(false))
  audio.addEventListener('ended', () => show(false))
  audio.addEventListener('error', () => {
    toggle.remove()
    preview.classList.remove('playable')
    preview.title = ''
  })
  preview.addEventListener('click', () => {
    try {
      if (playing) {
        audio.pause()
      } else {
        audio.muted = false
        void Promise.resolve(audio.play()).catch(() => show(false))
      }
    } catch {
      show(false)
    }
  })
}

function renderSelection(asset: CatalogAsset | null): void {
  const key = asset
    ? JSON.stringify([
        asset.id,
        asset.name,
        asset.kind,
        asset.root,
        asset.folder,
        asset.preview,
        asset.thumb,
        asset.wave,
        asset.hasAlpha
      ])
    : null
  if (key === shownSelection) return
  shownSelection = key
  selectionRow.textContent = ''
  selectionRow.style.display = asset ? '' : 'none'
  if (!asset) return

  const preview = el('div', `preview${asset.hasAlpha ? ' thumb alpha' : ''}`)
  if (asset.preview && asset.kind === 'video') {
    videoPreview(asset, asset.preview, preview)
  } else if (asset.preview && asset.kind === 'audio') {
    audioPreview(asset, asset.preview, preview)
  } else if (asset.thumb || asset.wave) {
    preview.append(previewImage((asset.thumb ?? asset.wave) as string))
  }
  const text = el('div', 'selection-text')
  text.append(el('div', 'name', asset.name), el('div', 'meta', `${asset.root}/${asset.folder}`))
  selectionRow.append(preview, text)
}

const modeSelect = el('select')
const placeButton = el('div', 'button primary', 'Add at playhead')
const importButton = el('div', 'button', 'Import')

function buildControls(): void {
  controls.append(
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
    if (asset) void place(asset)
  })
  importButton.addEventListener('click', () => {
    const asset = selected()
    if (asset) void importSelected(asset)
  })
  controls.append(modeSelect, placeButton, importButton)
}

function setDisabled(node: HTMLElement, disabled: boolean): void {
  if (disabled) node.classList.add('disabled')
  else node.classList.remove('disabled')
}

function renderFooter(): void {
  const asset = selected()
  renderSelection(asset)
  setDisabled(placeButton, !asset || state.busy)
  setDisabled(importButton, !asset || state.busy)

  const hint = state.status
    ? state.status
    : {
        text: asset
          ? canDrag
            ? 'Double-click or drag onto the timeline.'
            : 'Double-click to add at the playhead.'
          : state.catalog
            ? `${state.visible.length.toLocaleString()} assets`
            : '',
        tone: 'info' as const
      }
  statusLine.className = `status${hint.tone === 'info' ? '' : ` ${hint.tone}`}`
  statusLine.textContent = hint.text
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderChips(): void {
  chips.textContent = ''
  for (const kind of KINDS) {
    const chip = el('div', `chip${state.kind === kind.id ? ' active' : ''}`, kind.label)
    chip.addEventListener('click', () => {
      state.kind = kind.id
      renderChips()
      applyFilter(true)
    })
    chips.append(chip)
  }
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
  if (event.key !== 'Enter' || event.repeat) return
  // Enter in a field, menu or button belongs to that control, not to "add at playhead".
  const target = event.target as HTMLElement | null
  if (target?.tagName && TYPING_TAGS.includes(target.tagName.toLowerCase())) return
  if (document.activeElement === search) return
  const asset = selected()
  if (asset) void place(asset)
})

// ── Start ───────────────────────────────────────────────────────────────────

renderChips()
buildControls()
renderGrid()
renderFooter()
void refreshCatalog(true)
// The desktop app rewrites the catalog whenever the library changes; pick that up.
setInterval(() => void refreshCatalog(false), POLL_MS)

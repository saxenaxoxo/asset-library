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
import { insertAtPlayhead, importOnly, UserError, type InsertOptions } from './premiere'
import { dragContentType, DRAG_MIN_MAJOR, fileUri, fileUrl, hostMajor } from './paths'

const uxp = require('uxp')
const canDrag = hostMajor(uxp.host.version) >= DRAG_MIN_MAJOR

const TILE_MIN = 132
const GAP = 8
const CAPTION = 34
const POLL_MS = 3000

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
    const saved = JSON.parse(
      localStorage.getItem('assetLibrary.insertOptions') ?? 'null'
    ) as InsertOptions | null
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

function applyFilter(): void {
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
  grid.scrollTop = 0
  renderGrid()
  renderFooter()
}

async function refreshCatalog(force = false): Promise<void> {
  if (!state.catalogPath) state.catalogPath = await locateCatalog()
  if (!state.catalogPath) {
    state.error = "Couldn't find your Asset Library catalog. Choose it to continue."
    renderGrid()
    return
  }
  const mtime = await modifiedTime(state.catalogPath)
  if (!force && mtime !== null && mtime === state.catalogMtime) return
  try {
    const catalog = await loadCatalog(state.catalogPath)
    if (!force && state.catalog && catalog.updatedAt === state.catalog.updatedAt) return
    state.catalog = catalog
    state.catalogMtime = mtime
    state.error = null
    applyFilter()
  } catch (error) {
    state.catalog = null
    state.error = (error as Error).message
    renderGrid()
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

function buildTile(asset: CatalogAsset, box: Layout): HTMLElement {
  const tile = el('div', `tile${asset.id === state.selectedId ? ' selected' : ''}`)
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
      const ratio = Math.min(0.999, Math.max(0, event.offsetX / box.tileWidth))
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

function renderMessage(
  title: string,
  body: string,
  actions: { label: string; run: () => void }[] = []
): void {
  grid.textContent = ''
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

function renderGrid(): void {
  if (state.error) {
    renderMessage('Your library isn’t connected yet', state.error, [
      { label: 'Try again', run: () => void refreshCatalog(true) },
      {
        label: 'Choose catalog…',
        run: () =>
          void chooseCatalog().then((path) => {
            if (path) {
              state.catalogPath = path
              void refreshCatalog(true)
            }
          })
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

  const box = layout()
  const rows = Math.ceil(state.visible.length / box.columns)
  const first = Math.max(0, Math.floor(grid.scrollTop / box.rowHeight) - 2)
  const last = Math.min(
    rows - 1,
    Math.ceil((grid.scrollTop + grid.clientHeight) / box.rowHeight) + 2
  )

  grid.textContent = ''
  const spacer = el('div')
  spacer.style.height = `${rows * box.rowHeight + GAP}px`
  spacer.style.position = 'relative'
  for (let row = first; row <= last; row++) {
    for (let column = 0; column < box.columns; column++) {
      const asset = state.visible[row * box.columns + column]
      if (!asset) break
      const tile = buildTile(asset, box)
      tile.style.left = `${GAP + column * (box.tileWidth + GAP)}px`
      tile.style.top = `${GAP + row * box.rowHeight}px`
      spacer.append(tile)
    }
  }
  grid.append(spacer)
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
  localStorage.setItem('assetLibrary.insertOptions', JSON.stringify(state.options))
}

function renderFooter(): void {
  footer.textContent = ''
  const asset = selected()

  if (asset) {
    const row = el('div', 'selection')
    const preview = el('div', `preview${asset.hasAlpha ? ' thumb alpha' : ''}`)
    if (asset.preview && (asset.kind === 'video' || asset.kind === 'audio')) {
      const video = el('video')
      video.setAttribute('src', fileUrl(asset.preview))
      video.setAttribute('autoplay', '')
      video.setAttribute('loop', '')
      if (asset.kind === 'video') video.setAttribute('muted', '')
      video.style.width = '96px'
      video.style.height = '54px'
      const fallback = asset.kind === 'audio' ? asset.wave : asset.thumb
      video.addEventListener('error', () => {
        preview.textContent = ''
        if (fallback) {
          const img = el('img')
          img.style.width = '96px'
          img.style.height = '54px'
          showLocalImage(img, fallback, mimeFor(fallback))
          preview.append(img)
        }
      })
      preview.append(video)
    } else if (asset.thumb || asset.wave) {
      const img = el('img')
      img.style.width = '96px'
      img.style.height = '54px'
      const path = (asset.thumb ?? asset.wave) as string
      showLocalImage(img, path, mimeFor(path))
      preview.append(img)
    }
    const text = el('div', 'selection-text')
    text.append(el('div', 'name', asset.name), el('div', 'meta', `${asset.root}/${asset.folder}`))
    row.append(preview, text)
    footer.append(row)
  }

  const controls = el('div', 'controls')
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
  const mode = el('select')
  mode.setAttribute('aria-label', 'Edit type')
  for (const [value, label] of [
    ['overwrite', 'Overwrite'],
    ['insert', 'Insert']
  ] as const) {
    const option = el('option', '', label)
    option.value = value
    if (state.options.mode === value) option.selected = true
    mode.append(option)
  }
  mode.addEventListener('change', () => {
    state.options.mode = mode.value === 'insert' ? 'insert' : 'overwrite'
    saveOptions()
  })
  controls.append(mode)

  const placeButton = el(
    'div',
    `button primary${!asset || state.busy ? ' disabled' : ''}`,
    'Add at playhead'
  )
  placeButton.addEventListener('click', () => asset && void place(asset))
  const importButton = el('div', `button${!asset || state.busy ? ' disabled' : ''}`, 'Import')
  importButton.addEventListener('click', () => asset && void importSelected(asset))
  controls.append(placeButton, importButton)
  footer.append(controls)

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
  footer.append(el('div', `status${hint.tone === 'info' ? '' : ` ${hint.tone}`}`, hint.text))
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderChips(): void {
  chips.textContent = ''
  for (const kind of KINDS) {
    const chip = el('div', `chip${state.kind === kind.id ? ' active' : ''}`, kind.label)
    chip.addEventListener('click', () => {
      state.kind = kind.id
      renderChips()
      applyFilter()
    })
    chips.append(chip)
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
search.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    state.text = search.value
    applyFilter()
  }, 120)
})

document.addEventListener('keydown', (event) => {
  const asset = selected()
  if (event.key === 'Enter' && asset && document.activeElement !== search) void place(asset)
})

// ── Start ───────────────────────────────────────────────────────────────────

renderChips()
renderGrid()
renderFooter()
void refreshCatalog(true)
// The desktop app rewrites the catalog whenever the library changes; pick that up.
setInterval(() => void refreshCatalog(false), POLL_MS)

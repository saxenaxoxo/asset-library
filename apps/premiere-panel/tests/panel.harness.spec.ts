import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// MOCKED: the real panel UI with a fake Premiere API (see tests/harness). Real Premiere
// behaviour is verified by hand inside Premiere Pro.
const FFMPEG = join(
  __dirname,
  '..',
  '..',
  'desktop',
  'resources',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  'ffmpeg'
)
test.skip(!existsSync(FFMPEG), 'Needs the bundled FFmpeg to make thumbnails')

let home: string
let catalogDir: string

function thumb(file: string, source: string): string {
  execFileSync(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-frames:v',
    '1',
    file
  ])
  return file
}

test.beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'asset-library-panel-'))
  const dir = join(home, 'Library', 'Application Support', 'Asset Library', 'catalog')
  catalogDir = dir
  const media = join(home, 'media')
  mkdirSync(dir, { recursive: true })
  mkdirSync(media, { recursive: true })
  const base = {
    fps: 25,
    favorite: false,
    tags: [],
    sprite: null,
    preview: null,
    wave: null,
    root: 'SSD'
  }
  const catalog = {
    version: 1,
    updatedAt: 1,
    app: '0.1.0',
    roots: [{ id: 1, label: 'SSD', online: true, path: '/Volumes/SSD' }],
    tags: [],
    assets: [
      {
        ...base,
        id: 'a',
        name: 'Glitch 04.mov',
        kind: 'video',
        path: '/Volumes/SSD/Transitions/Glitch 04.mov',
        folder: 'Transitions',
        durationMs: 1200,
        width: 1920,
        height: 1080,
        hasAlpha: false,
        addedAt: 3,
        thumb: thumb(join(media, 'a.jpg'), 'testsrc=size=480x270')
      },
      {
        ...base,
        id: 'b',
        name: 'Light Leak.mov',
        kind: 'video',
        path: '/Volumes/SSD/Overlays/Light Leak.mov',
        folder: 'Overlays',
        durationMs: 4000,
        width: 3840,
        height: 2160,
        hasAlpha: true,
        favorite: true,
        addedAt: 2,
        thumb: thumb(join(media, 'b.png'), 'color=c=0xA78BFA@0.5:size=480x270,format=rgba')
      },
      {
        ...base,
        id: 'c',
        name: 'Whoosh Big.wav',
        kind: 'audio',
        path: '/Volumes/SSD/SFX/Whoosh Big.wav',
        folder: 'SFX',
        durationMs: 2300,
        width: null,
        height: null,
        hasAlpha: null,
        addedAt: 1,
        thumb: null,
        wave: thumb(join(media, 'c.png'), 'color=c=0x1e1e25:size=480x96')
      }
    ]
  }
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog))
})

test.afterAll(() => rmSync(home, { recursive: true, force: true }))

/** Request files the panel has written for the engine, oldest first. */
function requests(): Record<string, unknown>[] {
  const dir = join(catalogDir, 'requests')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>)
}

function requestIds(): string[] {
  const dir = join(catalogDir, 'requests')
  return existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .map((name) => name.replace(/\.json$/, ''))
    : []
}

/** Pretends the engine is running, optionally reporting results for requests. */
function engineStatus(results: { id: string; ok: boolean; message: string }[] = []): void {
  writeFileSync(
    join(catalogDir, 'engine.json'),
    JSON.stringify({
      version: '0.1.0',
      updatedAt: Date.now(),
      indexing: { rootIds: [], filesSeen: 0 },
      pendingMedia: 0,
      settings: { startAtLogin: true },
      cacheBytes: 12 * 1024 * 1024,
      importsFolder: '/Users/me/Movies/Asset Library Imports',
      results: results.map((r) => ({ ...r, at: Date.now() }))
    })
  )
}

test('panel browses folders, organizes, and places the selection at the playhead', async () => {
  engineStatus()
  const app = await electron.launch({
    args: [join(__dirname, 'harness', 'main.cjs')],
    env: { ...process.env, HARNESS_HOME: home }
  })
  const page = await app.firstWindow()
  const calls = (): Promise<{ type: string }[]> =>
    page.evaluate(() => (window as unknown as { __calls: { type: string }[] }).__calls)
  const tiles = page.locator('.tile')

  // Browse is the default: the tree lists the library folder (opened) with its folders, and
  // opening a folder shows its files in the tree and the grid.
  await expect(tiles).toHaveCount(3)
  await expect(page.locator('.tab.active')).toHaveText('Browse')
  await expect(page.locator('.tree-row.section', { hasText: 'SSD' })).toBeVisible()
  await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
  await expect(tiles).toHaveCount(1)
  await expect(page.locator('.tree-row.file', { hasText: 'Whoosh Big.wav' })).toBeVisible()
  await expect(page.locator('.folder-select')).toHaveValue('1/SFX')
  // The toolbar's folder menu goes anywhere too.
  await page.selectOption('.folder-select', '1/Overlays')
  await expect(tiles).toHaveCount(1)
  await expect(page.locator('.tile', { hasText: 'Light Leak.mov' })).toBeVisible()
  await page.locator('.tree-row', { hasText: 'Favorites' }).click()
  await expect(tiles).toHaveCount(1)
  await page.locator('.tree-row', { hasText: 'All assets' }).click()
  await expect(tiles).toHaveCount(3)
  await expect(page.locator('.badge.alpha')).toHaveCount(1)

  // Search, and the favorites-only star next to it.
  await page.fill('.search', 'leak')
  await expect(tiles).toHaveCount(1)
  await page.fill('.search', '')
  await expect(tiles).toHaveCount(3)
  await page.locator('.star-toggle').click()
  await expect(tiles).toHaveCount(1)
  await page.locator('.star-toggle').click()
  await expect(tiles).toHaveCount(3)

  // The size menu changes the thumbnails.
  const widthBefore = await tiles.first().evaluate((n) => (n as HTMLElement).offsetWidth)
  await page.selectOption('.size-select', '220')
  await expect
    .poll(() => tiles.first().evaluate((n) => (n as HTMLElement).offsetWidth))
    .not.toBe(widthBefore)
  await page.selectOption('.size-select', '120')

  // No selection preview: the selected tile is highlighted, nothing else.
  await expect(page.locator('.preview')).toHaveCount(0)

  // Choose V2 / A2, select an overlay, add it at the playhead.
  await page.selectOption('select[aria-label="Video track"]', '1')
  await page.selectOption('select[aria-label="Audio track"]', '1')
  await page.locator('.tile', { hasText: 'Light Leak.mov' }).click()
  await page.screenshot({ path: 'test-results/panel.png' })
  await page.locator('.button.primary', { hasText: 'Add at playhead' }).click()
  await expect(page.locator('.status.ok')).toContainText('Light Leak.mov')
  expect(await calls()).toEqual([
    { type: 'import', paths: ['/Volumes/SSD/Overlays/Light Leak.mov'], bin: 'Asset Library' },
    { type: 'overwrite', item: 'Light Leak.mov', seconds: 12.5, v: 1, a: 1 }
  ])

  // Adding it again reuses the imported clip instead of importing twice.
  await page.locator('.tile', { hasText: 'Light Leak.mov' }).dblclick()
  await expect.poll(async () => (await calls()).length).toBe(3)

  // Favorite from the tile's star: shown at once, sent to the engine.
  const glitch = page.locator('.tile', { hasText: 'Glitch 04.mov' })
  await glitch.hover()
  await glitch.locator('.star').click()
  await expect(glitch.locator('.star.on')).toBeVisible()
  await expect(
    page.locator('.tree-row', { hasText: 'Favorites' }).locator('.tree-count')
  ).toHaveText('2')
  expect(requests().at(-1)).toEqual({ type: 'set-favorite', id: 'a', favorite: true })

  // ...and from the star in the tree's gutter.
  await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
  await page.locator('.tree-row.file', { hasText: 'Whoosh Big.wav' }).locator('.gutter').click()
  await expect(
    page.locator('.tree-row.file', { hasText: 'Whoosh Big.wav' }).locator('.gutter.on')
  ).toBeVisible()
  expect(requests().at(-1)).toEqual({ type: 'set-favorite', id: 'c', favorite: true })
  await page.locator('.tree-row', { hasText: 'All assets' }).click()

  // Tags on the selection.
  const whoosh = page.locator('.tile', { hasText: 'Whoosh Big.wav' })
  const node = await whoosh.elementHandle()
  await whoosh.click()
  await expect(whoosh).toHaveClass(/selected/)
  expect(await node?.evaluate((n) => n.isConnected)).toBe(true)
  await page.locator('.tag-row .button', { hasText: '+ Tag' }).click()
  await page.fill('.tag-input', 'impact')
  await page.press('.tag-input', 'Enter')
  await expect(page.locator('.tag', { hasText: 'impact' })).toBeVisible()
  expect(requests().at(-1)).toEqual({ type: 'add-tag', id: 'c', tag: 'impact' })
  await page.locator('.tree-row.section', { hasText: 'Tags' }).click()
  await expect(page.locator('.tree-row', { hasText: 'impact' })).toBeVisible()

  // Import copies files into the folder you're in.
  await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
  await page.evaluate(() => {
    ;(window as unknown as { __pick: unknown }).__pick = { files: ['/Users/me/Downloads/Boom.wav'] }
  })
  await page.locator('.toolbar .button', { hasText: 'Import' }).click()
  await expect
    .poll(() => requests().at(-1))
    .toEqual({
      type: 'import-files',
      files: ['/Users/me/Downloads/Boom.wav'],
      rootId: 1,
      folder: 'SFX'
    })

  // Add a folder; the engine's result shows in the status line.
  await page.evaluate(() => {
    ;(window as unknown as { __pick: unknown }).__pick = { folder: '/Volumes/SSD/New Pack' }
  })
  await page.locator('.tree-head .button').click()
  await expect
    .poll(() => requests().at(-1))
    .toEqual({ type: 'add-folder', path: '/Volumes/SSD/New Pack' })
  engineStatus([{ id: requestIds().at(-1) as string, ok: true, message: 'Added New Pack' }])
  await expect(page.locator('.status.ok')).toHaveText('Added New Pack')

  // Settings: folders can be removed (after a confirm), files stay put.
  await page.locator('.tab', { hasText: 'Settings' }).click()
  await expect(page.locator('.settings-title', { hasText: 'Library folders' })).toBeVisible()
  await expect(page.locator('.folder-name', { hasText: 'SSD' })).toBeVisible()
  await expect(page.locator('.settings')).toContainText('12 MB')
  await page.locator('.folder-row .button', { hasText: 'Remove' }).click()
  await page.locator('.folder-row .button', { hasText: 'Confirm' }).click()
  await expect.poll(() => requests().at(-1)).toEqual({ type: 'remove-folder', rootId: 1 })
  // Uninstall is handed to the engine, which asks the editor to confirm in its own dialog.
  await page.locator('.settings .button', { hasText: 'Uninstall…' }).click()
  await expect.poll(() => requests().at(-1)).toEqual({ type: 'uninstall' })
  await page.screenshot({ path: 'test-results/panel-settings.png' })
  await page.locator('.tab', { hasText: 'Browse' }).click()

  // Enter inside a menu belongs to the menu, not to "add at playhead".
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click()
  const before = (await calls()).length
  await page.locator('select[aria-label="Video track"]').dispatchEvent('keydown', { key: 'Enter' })
  await page.waitForTimeout(300)
  expect((await calls()).length).toBe(before)
  // ...while Enter elsewhere still adds the selection (imports Whoosh, then places it).
  await page.locator('.grid').dispatchEvent('keydown', { key: 'Enter' })
  await expect.poll(async () => (await calls()).length).toBe(before + 2)

  // Several at once: shift-click selects a range, Enter adds them one after another (the
  // playhead moves on by each clip's length), and Recent then lists them.
  await page.locator('.tree-row', { hasText: 'All assets' }).click()
  await expect(tiles).toHaveCount(3)
  await page.locator('.tile', { hasText: 'Glitch 04.mov' }).click()
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.tile.selected')).toHaveCount(3)
  await expect(page.locator('.controls .button.primary')).toHaveText('Add 3 at playhead')
  const placed = (await calls()).length
  await page.locator('.grid').dispatchEvent('keydown', { key: 'Enter' })
  // Glitch: import + overwrite; Light Leak and Whoosh are imported already; 3 playhead moves.
  await expect.poll(async () => (await calls()).length).toBe(placed + 7)
  expect((await calls()).filter((c) => c.type === 'playhead')).toHaveLength(3)
  await expect(page.locator('.status.ok')).toContainText('Added 3 assets')
  await page.locator('.tree-row', { hasText: 'Recent' }).click()
  await expect(tiles).toHaveCount(3)

  // The type menu narrows the grid; a search can look in the folder or everywhere.
  await page.locator('.tree-row', { hasText: 'All assets' }).click()
  await page.selectOption('.type-select', 'audio')
  await expect(tiles).toHaveCount(1)
  await page.selectOption('.type-select', 'all')
  await expect(tiles).toHaveCount(3)
  await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
  await page.fill('.search', 'leak')
  await expect(tiles).toHaveCount(0)
  await page.selectOption('.scope-select', 'all')
  await expect(tiles).toHaveCount(1)
  await page.selectOption('.scope-select', 'folder')
  await page.fill('.search', '')
  await expect(tiles).toHaveCount(1)

  // Sound plays through the engine; Escape clears the selection.
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).locator('.play').click()
  await expect.poll(() => requests().at(-1)).toEqual({ type: 'play-audio', id: 'c' })
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click()
  await expect(page.locator('.tile.selected')).toHaveCount(1)
  await page.locator('.grid').dispatchEvent('keydown', { key: 'Escape' })
  await expect(page.locator('.tile.selected')).toHaveCount(0)
  await app.close()
})

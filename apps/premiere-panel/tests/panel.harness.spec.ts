import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    roots: [{ id: 1, label: 'SSD', online: true }],
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

test('panel lists the library, searches, and places the selection at the playhead', async () => {
  const app = await electron.launch({
    args: [join(__dirname, 'harness', 'main.cjs')],
    env: { ...process.env, HARNESS_HOME: home }
  })
  const page = await app.firstWindow()
  const tiles = page.locator('.tile')
  await expect(tiles).toHaveCount(3)
  await expect(page.locator('.badge.alpha')).toHaveCount(1)

  await page.fill('.search', 'leak')
  await expect(tiles).toHaveCount(1)
  await page.fill('.search', '')
  await expect(tiles).toHaveCount(3)
  await page.locator('.chip', { hasText: 'Audio' }).click()
  await expect(tiles).toHaveCount(1)
  await page.locator('.chip', { hasText: 'All' }).click()

  // Choose V2 / A2, select an overlay, add it at the playhead.
  await page.selectOption('select[aria-label="Video track"]', '1')
  await page.selectOption('select[aria-label="Audio track"]', '1')
  await page.locator('.tile', { hasText: 'Light Leak.mov' }).click()
  await page.screenshot({ path: 'test-results/panel.png' })
  await page.locator('.button.primary', { hasText: 'Add at playhead' }).click()
  await expect(page.locator('.status.ok')).toContainText('Light Leak.mov')

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)
  expect(calls).toEqual([
    { type: 'import', paths: ['/Volumes/SSD/Overlays/Light Leak.mov'], bin: 'Asset Library' },
    { type: 'overwrite', item: 'Light Leak.mov', seconds: 12.5, v: 1, a: 1 }
  ])

  // Adding it again reuses the imported clip instead of importing twice.
  await page.locator('.tile', { hasText: 'Light Leak.mov' }).dblclick()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length))
    .toBe(3)

  // Tiles survive re-renders, so selecting one keeps the same node (and its loaded image).
  const whoosh = page.locator('.tile', { hasText: 'Whoosh Big.wav' })
  const node = await whoosh.elementHandle()
  await whoosh.click()
  await expect(whoosh).toHaveClass(/selected/)
  expect(await node?.evaluate((n) => n.isConnected)).toBe(true)

  // Enter inside a menu belongs to the menu, not to "add at playhead".
  await page.locator('select[aria-label="Video track"]').dispatchEvent('keydown', { key: 'Enter' })
  await page.waitForTimeout(300)
  expect(
    await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)
  ).toBe(3)
  // ...while Enter elsewhere still adds the selection (imports Whoosh, then places it).
  await page.locator('.grid').dispatchEvent('keydown', { key: 'Enter' })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length))
    .toBe(5)
  await app.close()
})

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FFMPEG } from './harness/library'

// Renders the README screenshot of the asset grid: the real panel UI with the fake Premiere API
// and a demo library. Every thumbnail is drawn by FFmpeg here (gradients, noise, waveforms),
// so the picture contains no third-party media. Run with `pnpm screenshot` (macOS/Linux).
test.skip(!process.env.SCREENSHOT, 'Only runs for `pnpm screenshot`')
test.skip(!existsSync(FFMPEG), 'Needs the bundled FFmpeg to make thumbnails')

const IMAGES = join(__dirname, '..', '..', '..', 'docs', 'images')
const OUT = join(IMAGES, 'asset-grid.png')

let home: string

function frame(file: string, source: string, filters?: string): string {
  execFileSync(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    ...(filters ? ['-vf', filters] : []),
    '-frames:v',
    '1',
    file
  ])
  return file
}

function wave(file: string, expr: string, seconds: number): string {
  execFileSync(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${expr}:s=44100:d=${seconds}`,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=960x160:colors=0xC6FF3D',
    '-frames:v',
    '1',
    file
  ])
  return file
}

test.beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'asset-library-shot-'))
  const dir = join(home, 'Library', 'Application Support', 'Asset Library', 'catalog')
  const media = join(home, 'media')
  mkdirSync(dir, { recursive: true })
  mkdirSync(media, { recursive: true })
  const g = (name: string, spec: string, filters?: string): string =>
    frame(join(media, `${name}.png`), `gradients=s=480x270:${spec}`, filters)
  const base = {
    fps: 25,
    favorite: false,
    tags: [],
    sprite: null,
    preview: null,
    wave: null,
    thumb: null,
    width: 1920,
    height: 1080,
    hasAlpha: false,
    root: 'SSD'
  }
  let added = 100
  const video = (
    name: string,
    folder: string,
    durationMs: number,
    thumb: string,
    extra = {}
  ): Record<string, unknown> => ({
    ...base,
    id: name,
    name,
    kind: 'video',
    path: `/Volumes/SSD/${folder}/${name}`,
    folder,
    durationMs,
    addedAt: added--,
    thumb,
    ...extra
  })
  const audio = (name: string, durationMs: number, image: string): Record<string, unknown> => ({
    ...base,
    id: name,
    name,
    kind: 'audio',
    path: `/Volumes/SSD/SFX/${name}`,
    folder: 'SFX',
    durationMs,
    width: null,
    height: null,
    hasAlpha: null,
    addedAt: added--,
    wave: image
  })
  const assets = [
    video(
      'Light Leak 02.mov',
      'Overlays',
      4000,
      g(
        'leak',
        'type=radial:c0=0xFFD9A0:c1=0xFF6A1A:c2=0x1A0905:x0=120:y0=60:x1=470:y1=260:nb_colors=3'
      ),
      { hasAlpha: true, favorite: true, width: 3840, height: 2160, tags: ['warm', 'overlay'] }
    ),
    video(
      'Neon Sweep.mov',
      'Transitions',
      1200,
      g(
        'neon',
        'c0=0x0B0420:c1=0xFF2E93:c2=0xFFD1F0:c3=0x00E5FF:x0=0:y0=270:x1=480:y1=0:nb_colors=4'
      )
    ),
    video(
      'Dust and Scratches.mov',
      'Overlays',
      10000,
      frame(
        join(media, 'dust.png'),
        'color=c=0x2A241C:s=480x270',
        'noise=alls=55:allf=t,vignette=PI/4'
      ),
      { hasAlpha: true, tags: ['overlay', 'texture'] }
    ),
    video(
      'Film Burn 01.mov',
      'Overlays',
      3000,
      g(
        'burn',
        'type=circular:c0=0xFFF1C7:c1=0xFF8A00:c2=0x7A0F00:c3=0x050302:x0=330:y0=120:x1=480:y1=270:nb_colors=4'
      ),
      { hasAlpha: true, tags: ['warm', 'overlay'] }
    ),
    video(
      'Bokeh Blue.mov',
      'Backgrounds',
      8000,
      g(
        'bokeh',
        'type=radial:c0=0x7FE7FF:c1=0x1450B8:c2=0x050A1C:x0=160:y0=110:x1=480:y1=270:nb_colors=3',
        'gblur=sigma=6'
      )
    ),
    video(
      'Smoke Wipe.mov',
      'Transitions',
      1500,
      g(
        'smoke',
        'type=radial:c0=0xE6E6EC:c1=0x5A5A66:c2=0x0E0E12:x0=150:y0=150:x1=480:y1=270:nb_colors=3',
        'noise=alls=30:allf=t,gblur=sigma=4'
      )
    ),
    video(
      'Sunset Grade.mov',
      'Backgrounds',
      6000,
      g('sunset', 'c0=0x2B1055:c1=0xD7316E:c2=0xFFB25B:x0=200:y0=0:x1=280:y1=270:nb_colors=3'),
      { tags: ['warm'] }
    ),
    video(
      'Lime Pulse.mov',
      'Transitions',
      900,
      g(
        'pulse',
        'type=radial:c0=0xEEFFC2:c1=0xC6FF3D:c2=0x0B0C09:x0=240:y0=135:x1=480:y1=270:nb_colors=3'
      )
    ),
    video(
      'Glitch 04.mov',
      'Transitions',
      800,
      frame(
        join(media, 'glitch.png'),
        'life=s=120x68:ratio=0.35:seed=7:life_color=#00E5FF:death_color=#0D0D12:mold_color=#FF2E93:mold=8',
        'scale=480:270:flags=neighbor'
      )
    ),
    audio(
      'Whoosh Big.wav',
      2300,
      wave(
        join(media, 'whoosh.png'),
        "'sin(2*PI*90*t)*exp(-((t-0.9)^2)*6)*(0.6+0.4*random(0))'",
        2.3
      )
    ),
    audio(
      'Riser 8s.wav',
      8000,
      wave(join(media, 'riser.png'), "'sin(2*PI*(110+60*t)*t)*(t/8)'", 8)
    ),
    audio(
      'Impact Hit.wav',
      1600,
      wave(join(media, 'impact.png'), "'sin(2*PI*55*t)*exp(-t*4)+0.3*random(0)*exp(-t*9)'", 1.6)
    )
  ]
  writeFileSync(
    join(dir, 'catalog.json'),
    JSON.stringify({
      version: 1,
      updatedAt: 1,
      app: '0.1.1',
      roots: [{ id: 1, label: 'SSD', online: true, path: '/Volumes/SSD' }],
      tags: ['overlay', 'texture', 'warm'],
      assets
    })
  )
  writeFileSync(
    join(dir, 'engine.json'),
    JSON.stringify({
      version: '0.1.1',
      updatedAt: Date.now(),
      indexing: { rootIds: [], filesSeen: 0 },
      pendingMedia: 0,
      settings: { startAtLogin: true },
      cacheBytes: 0,
      importsFolder: '/Users/me/Movies/Asset Library Imports',
      results: []
    })
  )
})

test.afterAll(() => rmSync(home, { recursive: true, force: true }))

test('asset grid screenshot for the README', async () => {
  const app = await electron.launch({
    args: [join(__dirname, 'harness', 'main.cjs')],
    env: { ...process.env, HARNESS_HOME: home }
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 1000))
    const tiles = page.locator('.tile')
    await expect(tiles).toHaveCount(12)
    await page.selectOption('.size-select', '160')
    await page.locator('.tile', { hasText: 'Light Leak 02.mov' }).click()
    // Let the thumbnails decode before the capture.
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.grid img')).every((i) => i.complete)
    )
    mkdirSync(join(OUT, '..'), { recursive: true })
    // Crop to the tiles themselves (the grid fills the window), with a small margin.
    const boxes = await tiles.evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect()
        return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }
      })
    )
    const pad = 6
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
    const right = Math.max(...boxes.map((b) => b.right)) + pad
    const bottom = Math.max(...boxes.map((b) => b.bottom)) + pad
    await page.screenshot({ path: OUT, clip: { x, y, width: right - x, height: bottom - y } })
  } finally {
    await app.close()
  }
})

/** Opens the panel at a panel-like size, runs `setup`, and captures everything above the track
 * and edit controls (only the tag chips of the bottom bar are kept). */
async function panelShot(name: string, setup: (page: Page) => Promise<void>): Promise<void> {
  // A fresh profile each time: the panel remembers the last folder and view.
  rmSync(join(home, 'profile'), { recursive: true, force: true })
  const app = await electron.launch({
    args: [join(__dirname, 'harness', 'main.cjs')],
    env: { ...process.env, HARNESS_HOME: home }
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640))
    await expect(page.locator('.tile')).toHaveCount(12)
    await page.selectOption('.size-select', '160')
    await setup(page)
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.grid img')).every((i) => i.complete)
    )
    const bottom = await page.evaluate(() => {
      const tags = document.querySelector<HTMLElement>('.tag-row')
      if (tags && tags.offsetParent !== null) return tags.getBoundingClientRect().bottom + 6
      return document.querySelector<HTMLElement>('.footer')!.getBoundingClientRect().top
    })
    const width = await page.evaluate(() => document.documentElement.clientWidth)
    mkdirSync(IMAGES, { recursive: true })
    await page.screenshot({ path: join(IMAGES, name), clip: { x: 0, y: 0, width, height: bottom } })
  } finally {
    await app.close()
  }
}

test('panel screenshot: search', async () => {
  await panelShot('panel-search.png', async (page) => {
    await page.fill('.search', 'warm')
    await expect(page.locator('.tile')).toHaveCount(3)
  })
})

test('panel screenshot: waveforms', async () => {
  await panelShot('panel-waveforms.png', async (page) => {
    await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
    await expect(page.locator('.tile')).toHaveCount(3)
    await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click()
  })
})

test('panel screenshot: tags', async () => {
  await panelShot('panel-tags.png', async (page) => {
    await page.locator('.tree-row.section', { hasText: 'Tags' }).click()
    await page.locator('.tree-row.special[title="overlay"]').click()
    await expect(page.locator('.tile')).toHaveCount(3)
    await page.locator('.tile', { hasText: 'Light Leak 02.mov' }).click()
    await expect(page.locator('.tag-row .tag')).toHaveCount(2)
  })
})

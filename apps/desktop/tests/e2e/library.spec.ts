import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { CatalogAsset } from '@catalog/types'
import { checksums, createFixtureLibrary, hasFfmpeg, OFFLINE_MANIFEST_URL } from './fixtures'

test.skip(!hasFfmpeg, 'Needs the bundled FFmpeg (run scripts/ffmpeg first)')

let libraryDir: string
let userDataDir: string

function launch(): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  // NO_LOGIN_ITEM: a test run must never add the app under test to the login items. Nor
  // install its panel into Premiere Pro or check for updates (installed builds do both).
  const env = {
    ...process.env,
    ASSET_LIBRARY_TEST_ROOT: libraryDir,
    ASSET_LIBRARY_NO_LOGIN_ITEM: '1',
    ASSET_LIBRARY_NO_PANEL_INSTALL: '1',
    ASSET_LIBRARY_NO_UPDATE_CHECK: '1',
    // The panel download list: never the real server in tests.
    ASSET_LIBRARY_TEST_MANIFEST_URL: OFFLINE_MANIFEST_URL
  }
  return electron.launch(
    executablePath
      ? { executablePath, args: [`--user-data-dir=${userDataDir}`], env }
      : { args: ['.', `--user-data-dir=${userDataDir}`], env }
  )
}

test.beforeAll(() => {
  libraryDir = mkdtempSync(join(tmpdir(), 'asset-library-fixtures-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'asset-library-profile-'))
  createFixtureLibrary(libraryDir)
})

test.afterAll(() => {
  rmSync(libraryDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
})

test('indexes a folder for the panel, reads media details, and keeps favorites', async () => {
  const before = checksums(libraryDir)
  const catalogDir = join(userDataDir, 'catalog')
  const catalogFile = join(catalogDir, 'catalog.json')
  // The panel reads the full catalog plus the changes since it (catalog-delta.json).
  const assets = (): Record<string, CatalogAsset> => {
    if (!existsSync(catalogFile)) return {}
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as { assets: CatalogAsset[] }
    const byName = Object.fromEntries(catalog.assets.map((a) => [a.name, a]))
    const deltaFile = join(catalogDir, 'catalog-delta.json')
    if (existsSync(deltaFile)) {
      const delta = JSON.parse(readFileSync(deltaFile, 'utf8')) as { upserts: CatalogAsset[] }
      for (const asset of delta.upserts) byName[asset.name] = asset
    }
    return byName
  }
  // The panel asks for changes by dropping request files; so does this test.
  const request = (body: object): void => {
    mkdirSync(join(catalogDir, 'requests'), { recursive: true })
    writeFileSync(join(catalogDir, 'requests', `${Date.now()}-e2e.json`), JSON.stringify(body))
  }

  let app = await launch()
  await app.firstWindow()

  // All four fixtures are indexed, with what FFprobe found and the media the panel shows.
  await expect
    .poll(
      () => {
        const byName = assets()
        return [
          Object.keys(byName).length,
          // FFprobe found the alpha channel in the ProRes 4444 overlay.
          byName['Purple Glow Overlay.mov']?.hasAlpha ?? null,
          // Hover-scrub strip, waveform and thumbnail, and the files really exist.
          Boolean(
            byName['Purple Glow Overlay.mov']?.sprite &&
            existsSync(byName['Purple Glow Overlay.mov'].sprite)
          ),
          Boolean(byName['Tone Hit.wav']?.wave && existsSync(byName['Tone Hit.wav'].wave)),
          Boolean(byName['Soft Grain.png']?.thumb && existsSync(byName['Soft Grain.png'].thumb)),
          byName['Test Pattern.mp4']?.width ?? null
        ]
      },
      { timeout: 60_000 }
    )
    .toEqual([4, true, true, true, true, 1280])

  // Favorite and tag from the panel.
  const tone = assets()['Tone Hit.wav']
  expect(tone).toBeDefined()
  request({ type: 'set-favorite', id: tone?.id, favorite: true })
  await expect.poll(() => assets()['Tone Hit.wav']?.favorite, { timeout: 20_000 }).toBe(true)
  request({ type: 'add-tag', id: tone?.id, tag: 'impacts' })
  await expect.poll(() => assets()['Tone Hit.wav']?.tags, { timeout: 20_000 }).toEqual(['impacts'])
  await app.close()

  // Favorites and tags survive a restart.
  app = await launch()
  await app.firstWindow()
  await expect
    .poll(() => [assets()['Tone Hit.wav']?.favorite, assets()['Tone Hit.wav']?.tags], {
      timeout: 20_000
    })
    .toEqual([true, ['impacts']])
  await app.close()

  // The original files were never modified.
  expect(checksums(libraryDir)).toEqual(before)
})

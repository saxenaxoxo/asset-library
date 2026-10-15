import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { CatalogAsset } from '@catalog/types'
import { createFixtureLibrary, hasFfmpeg } from './fixtures'

// The rename from Asset Library to Goated Panels Hub (decision I2): a library made under the old
// data folder name opens in the renamed app with its folders, favorites and tags, and a Premiere
// panel that only knows the old place still finds the catalog. Uses a throwaway appData folder.

test.skip(!hasFfmpeg, 'Needs the bundled FFmpeg (run scripts/ffmpeg first)')

let appData: string
let libraryDir: string

const env = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  ASSET_LIBRARY_TEST_ROOT: libraryDir,
  ASSET_LIBRARY_NO_LOGIN_ITEM: '1',
  ASSET_LIBRARY_NO_PANEL_INSTALL: '1',
  ASSET_LIBRARY_NO_UPDATE_CHECK: '1'
})

function launch(
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const options = { env: { ...env(), ...extraEnv } }
  return electron.launch(
    executablePath ? { ...options, executablePath, args } : { ...options, args: ['.', ...args] }
  )
}

function assetsIn(catalogDir: string): Record<string, CatalogAsset> {
  const file = join(catalogDir, 'catalog.json')
  if (!existsSync(file)) return {}
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as { assets: CatalogAsset[] }
  const byName = Object.fromEntries(catalog.assets.map((a) => [a.name, a]))
  const deltaFile = join(catalogDir, 'catalog-delta.json')
  if (existsSync(deltaFile)) {
    const delta = JSON.parse(readFileSync(deltaFile, 'utf8')) as { upserts: CatalogAsset[] }
    for (const asset of delta.upserts) byName[asset.name] = asset
  }
  return byName
}

test.beforeAll(() => {
  appData = mkdtempSync(join(tmpdir(), 'asset-library-appdata-'))
  libraryDir = mkdtempSync(join(tmpdir(), 'asset-library-fixtures-'))
  createFixtureLibrary(libraryDir)
})

test.afterAll(() => {
  rmSync(appData, { recursive: true, force: true })
  rmSync(libraryDir, { recursive: true, force: true })
})

test('moves a library from the old data folder name on first launch', async () => {
  const legacyDir = join(appData, 'Asset Library')
  const dataDir = join(appData, 'Goated Panels Hub')
  const legacyCatalog = join(legacyDir, 'catalog')

  // Before the rename: the app indexed the library into "Asset Library", and the editor
  // favorited a sound in the panel.
  let app = await launch([`--user-data-dir=${legacyDir}`])
  await app.firstWindow()
  await expect.poll(() => Object.keys(assetsIn(legacyCatalog)).length, { timeout: 60_000 }).toBe(4)
  const tone = assetsIn(legacyCatalog)['Tone Hit.wav']
  mkdirSync(join(legacyCatalog, 'requests'), { recursive: true })
  writeFileSync(
    join(legacyCatalog, 'requests', `${Date.now()}-e2e.json`),
    JSON.stringify({ type: 'set-favorite', id: tone?.id, favorite: true })
  )
  await expect
    .poll(() => assetsIn(legacyCatalog)['Tone Hit.wav']?.favorite, { timeout: 20_000 })
    .toBe(true)
  await app.close()

  // The renamed app's first launch, at its default data folder (which Electron creates, empty,
  // before the app's code runs).
  mkdirSync(dataDir)
  app = await launch([], { ASSET_LIBRARY_TEST_APPDATA: appData })
  const window = await app.firstWindow()
  await expect(window).toHaveTitle('Goated Panels Hub')
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir)
  expect(existsSync(join(dataDir, 'library.db'))).toBe(true)
  expect(existsSync(join(dataDir, 'settings.json'))).toBe(true)
  // Same library (not a fresh index): the favorite came along.
  await expect
    .poll(() => assetsIn(join(dataDir, 'catalog'))['Tone Hit.wav']?.favorite, { timeout: 20_000 })
    .toBe(true)
  expect(Object.keys(assetsIn(join(dataDir, 'catalog')))).toHaveLength(4)
  // The old name now points at the new folder, so an old panel reads the same catalog.
  expect(lstatSync(legacyDir).isSymbolicLink()).toBe(true)
  expect(readFileSync(join(legacyCatalog, 'catalog.json'), 'utf8')).toBe(
    readFileSync(join(dataDir, 'catalog', 'catalog.json'), 'utf8')
  )
  await app.close()

  // Later launches leave everything where it is.
  app = await launch([], { ASSET_LIBRARY_TEST_APPDATA: appData })
  await app.firstWindow()
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir)
  expect(lstatSync(legacyDir).isSymbolicLink()).toBe(true)
  await app.close()
})

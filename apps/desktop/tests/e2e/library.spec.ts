import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { checksums, createFixtureLibrary, hasFfmpeg } from './fixtures'

test.skip(!hasFfmpeg, 'Needs the bundled FFmpeg (run scripts/ffmpeg first)')

let libraryDir: string
let userDataDir: string

function launch(): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const env = { ...process.env, ASSET_LIBRARY_TEST_ROOT: libraryDir }
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

test('indexes a folder, reads media details, searches, and keeps favorites', async () => {
  const before = checksums(libraryDir)
  let app = await launch()
  let page = await app.firstWindow()

  // All four fixtures are indexed and shown.
  const tiles = page.getByRole('gridcell')
  await expect(tiles).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByText('4 assets')).toBeVisible()

  // FFprobe found the alpha channel in the ProRes 4444 overlay.
  const overlay = page.getByRole('gridcell', { name: /Purple Glow Overlay/ })
  await expect(overlay.getByText('Alpha')).toBeVisible({ timeout: 20_000 })

  // Search by part of a name, and by folder.
  await page.getByLabel('Search assets').fill('tone')
  await expect(tiles).toHaveCount(1)
  await page.getByLabel('Search assets').fill('overlays')
  await expect(tiles).toHaveCount(1)
  await page.getByLabel('Search assets').fill('')
  await expect(tiles).toHaveCount(4)

  // Filter by type from the sidebar.
  await page.getByRole('button', { name: /^Audio/ }).click()
  await expect(tiles).toHaveCount(1)
  await page.getByRole('button', { name: /^All assets/ }).click()

  // Favorite from the details panel.
  await page.getByRole('gridcell', { name: /Tone Hit/ }).click()
  const details = page.getByRole('complementary', { name: 'Asset details' })
  await expect(details.getByText('Stereo, 44.1 kHz')).toBeVisible()
  await details.getByRole('button', { name: 'Add to favorites' }).click()
  await details.getByLabel('Add a tag').fill('impacts')
  await details.getByRole('button', { name: 'Add tag' }).click()
  await expect(details.getByText('impacts')).toBeVisible()
  await page.screenshot({ path: 'test-results/library.png' })
  await app.close()

  // Favorites and tags survive a restart.
  app = await launch()
  page = await app.firstWindow()
  await page.getByRole('button', { name: /^Favorites/ }).click()
  await expect(page.getByRole('gridcell')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByRole('gridcell', { name: /Tone Hit/ })).toBeVisible()
  await page.getByRole('button', { name: /^impacts/ }).click()
  await expect(page.getByRole('gridcell')).toHaveCount(1)
  await app.close()

  // The original files were never modified.
  expect(checksums(libraryDir)).toEqual(before)
})

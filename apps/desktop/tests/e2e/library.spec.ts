import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { checksums, createFixtureLibrary, hasFfmpeg } from './fixtures'

test.skip(!hasFfmpeg, 'Needs the bundled FFmpeg (run scripts/ffmpeg first)')

let libraryDir: string
let userDataDir: string

function launch(): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  // NO_LOGIN_ITEM: a test run must never add the app under test to the login items.
  const env = {
    ...process.env,
    ASSET_LIBRARY_TEST_ROOT: libraryDir,
    ASSET_LIBRARY_NO_LOGIN_ITEM: '1'
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

  // Thumbnails, scrub strips and waveforms are generated and actually load.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Array.from(document.querySelectorAll('[role=gridcell] img')).filter(
              (img) =>
                (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
            ).length
        ),
      { timeout: 60_000 }
    )
    .toBe(4)

  // The Premiere panel's catalog is written with every asset and its media.
  const catalogFile = join(userDataDir, 'catalog', 'catalog.json')
  await expect.poll(() => existsSync(catalogFile), { timeout: 20_000 }).toBe(true)
  await expect
    .poll(
      () => {
        const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as {
          assets: {
            name: string
            thumb: string | null
            sprite: string | null
            wave: string | null
          }[]
        }
        const byName = Object.fromEntries(catalog.assets.map((a) => [a.name, a]))
        return [
          catalog.assets.length,
          // Hover-scrub strip (playable preview files aren't made: the panel can't play them).
          Boolean(byName['Purple Glow Overlay.mov']?.sprite),
          Boolean(byName['Tone Hit.wav']?.wave),
          Boolean(byName['Soft Grain.png']?.thumb)
        ]
      },
      { timeout: 30_000 }
    )
    .toEqual([4, true, true, true])

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
  await page.getByRole('gridcell', { name: /Purple Glow Overlay/ }).click()
  // No preview movies are made any more (the Premiere panel can't play them): video shows its
  // scrubbable thumbnail.
  await expect(details.locator('img').first()).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'test-results/library.png' })

  // Arrow keys move the selection; the details panel stays mounted instead of flashing.
  await tiles.nth(0).click()
  await expect(tiles.nth(0)).toHaveAttribute('aria-selected', 'true')
  const panel = await details.elementHandle()
  await page.keyboard.press('ArrowRight')
  await expect(tiles.nth(1)).toHaveAttribute('aria-selected', 'true')
  expect(await panel?.evaluate((element) => element.isConnected)).toBe(true)

  // Down moves a whole row in the grid (clamped to the last asset).
  const columns = await page.getByRole('row').first().getByRole('gridcell').count()
  await tiles.nth(0).click()
  await page.keyboard.press('ArrowDown')
  await expect(tiles.nth(Math.min(3, columns))).toHaveAttribute('aria-selected', 'true')

  // The list is reachable from the keyboard and moves one row at a time.
  await page.getByRole('button', { name: 'List view' }).click()
  const listbox = page.getByRole('listbox', { name: 'Assets' })
  const options = listbox.getByRole('option')
  await expect(options).toHaveCount(4)
  await options.nth(0).click()
  await expect(listbox).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  const activeId = await options.nth(1).getAttribute('id')
  await expect(listbox).toHaveAttribute('aria-activedescendant', activeId ?? '')
  await page.getByRole('button', { name: 'Grid view' }).click()
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

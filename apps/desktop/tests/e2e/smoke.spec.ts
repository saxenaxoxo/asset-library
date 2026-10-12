import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// Launches the built app (run `electron-vite build` first; `pnpm test:e2e` does both).
test('launches into the branded empty library', async () => {
  // A throwaway profile: never touches the real library, and runs beside an open copy of the app.
  const userDataDir = mkdtempSync(join(tmpdir(), 'asset-library-e2e-'))
  // E2E_EXECUTABLE runs the same test against a packaged app instead of the dev build.
  const executablePath = process.env['E2E_EXECUTABLE']
  const app = await electron.launch(
    executablePath
      ? { executablePath, args: [`--user-data-dir=${userDataDir}`] }
      : { args: ['.', `--user-data-dir=${userDataDir}`] }
  )
  const page = await app.firstWindow()

  await expect(page).toHaveTitle('Asset Library')
  await expect(page.getByRole('heading', { name: 'Bring your assets together' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add folder' }).first()).toBeVisible()
  await expect(page.getByRole('img', { name: 'Asset Library' }).first()).toBeVisible()
  await expect(page.getByText('Version 0.1.0')).toBeVisible()

  // The renderer must not be able to reach Node, and only the typed bridge is exposed.
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined'
  )
  expect(
    await page.evaluate(() =>
      Object.keys((globalThis as unknown as { assetLibrary: object }).assetLibrary).sort()
    )
  ).toEqual([
    'addFolder',
    'addTag',
    'getAppInfo',
    'getAsset',
    'getCounts',
    'getDiagnostics',
    'getHosts',
    'listRoots',
    'listTags',
    'onLibraryEvent',
    'pickDragTestFiles',
    'queryAssets',
    'removeRoot',
    'removeTag',
    'rescan',
    'revealAsset',
    'sendToAfterEffects',
    'setFavorite',
    'startDrag'
  ])

  // The native SQLite module loads inside Electron, with full-text search.
  const diagnostics = await page.evaluate(() =>
    (
      globalThis as unknown as {
        assetLibrary: {
          getDiagnostics(): Promise<{
            sqliteVersion: string
            fts5: boolean
            ffprobeVersion: string | null
          }>
        }
      }
    ).assetLibrary.getDiagnostics()
  )
  expect(diagnostics.fts5).toBe(true)
  expect(diagnostics.sqliteVersion).toMatch(/^3\./)
  // Packaged builds must ship a working FFprobe (run in the utility process).
  if (executablePath) expect(diagnostics.ffprobeVersion).toMatch(/^\d+\.\d+/)

  await page.waitForTimeout(800) // let the one-time shelf animation settle
  await page.screenshot({ path: 'test-results/shell.png' })
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

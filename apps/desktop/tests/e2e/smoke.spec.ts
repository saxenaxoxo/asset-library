import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OFFLINE_MANIFEST_URL } from './fixtures'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

// The app's own version, so the tests don't need editing at every release.
const { version: APP_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
) as { version: string }

// Launches the built app (run `electron-vite build` first; `pnpm test:e2e` does both).
// E2E_EXECUTABLE runs the same tests against a packaged app instead of the dev build.
function launch(userDataDir: string, ...extra: string[]): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const args = [`--user-data-dir=${userDataDir}`, ...extra]
  // A test run must never add the app under test to the login items, install its panel into
  // Premiere Pro or check for updates (installed builds do both).
  const env = {
    ...process.env,
    ASSET_LIBRARY_NO_LOGIN_ITEM: '1',
    ASSET_LIBRARY_NO_PANEL_INSTALL: '1',
    ASSET_LIBRARY_NO_UPDATE_CHECK: '1',
    // The panel download list: never the real server in tests.
    ASSET_LIBRARY_TEST_MANIFEST_URL: OFFLINE_MANIFEST_URL
  }
  return electron.launch(
    executablePath ? { executablePath, args, env } : { args: ['.', ...args], env }
  )
}

test('opens the installer: install, manage, about and help', async () => {
  // A throwaway profile: never touches the real library, and runs beside an open copy of the app.
  const userDataDir = mkdtempSync(join(tmpdir(), 'asset-library-e2e-'))
  const executablePath = process.env['E2E_EXECUTABLE']
  const app = await launch(userDataDir)
  const page = await app.firstWindow()

  await expect(page).toHaveTitle('Goated Panels Hub')
  await expect(page.getByRole('img', { name: 'Goated Panels' }).first()).toBeVisible()
  await expect(page.getByText('Goated Panels Hub').first()).toBeVisible()
  await expect(page.getByRole('img', { name: 'Asset Library' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Asset Library for Premiere Pro' })).toBeVisible()
  // Both methods are offered as radio cards; what's installed is read, never assumed.
  const methods = page.getByRole('radiogroup', { name: 'Installation method' })
  await expect(methods.getByRole('radio')).toHaveCount(2)
  await expect(methods.getByText('Modern')).toBeVisible()
  await expect(methods.getByText('Legacy')).toBeVisible()
  // Read from Adobe's real installer on this computer: with the panel installed, both the summary
  // and the method card say "Installed:".
  await expect(page.getByText(/Not installed|Installed:|Couldn't check/).first()).toBeVisible({
    timeout: 20_000
  })
  const primary = page.locator('footer').getByRole('button').last()
  await expect(primary).toBeVisible()
  if (!executablePath) {
    // A development build carries no panel, so it can't install one, and says why.
    await expect(primary).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('development copy')
  }
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/installer.png' })

  // After Effects: honestly not available yet.
  await page.getByText('After Effects', { exact: true }).click()
  await expect(page.getByText('No After Effects panel yet')).toBeVisible()
  await expect(
    page.locator('footer').getByRole('button', { name: 'Not available yet' })
  ).toBeDisabled()

  // Every screen says the Hub is the engine the panel needs, and that it keeps running.
  const engineBar = page.getByRole('region', { name: 'Engine status' })
  await expect(engineBar).toContainText('Goated Panels Hub is running')
  await expect(engineBar).toContainText("Closing this window doesn't stop it")
  await expect(page.locator('footer').getByRole('button', { name: 'Close window' })).toBeVisible()

  await page.getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByRole('heading', { name: 'Background engine' })).toBeVisible()
  const login = page.getByRole('checkbox', { name: /Start Goated Panels Hub when I log in/ })
  await expect(login).toBeChecked()
  await login.uncheck()
  await expect(login).not.toBeChecked()
  await login.check()
  await expect(login).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Installed panels' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/installer-manage.png' })
  await expect(page.getByRole('button', { name: 'Uninstall Goated Panels Hub…' })).toBeVisible()
  await page.getByRole('button', { name: 'About' }).click()
  await expect(page.getByText('App version')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Goated Panels Hub' })).toBeVisible()
  await expect(page.getByText('Asset Library by goatedpanels.in')).toBeVisible()
  await expect(page.getByText(APP_VERSION).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Source code/ })).toBeVisible()
  await page.getByRole('button', { name: 'Help', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Install in five steps' })).toBeVisible()
  await expect(page.getByText(/Keep Goated Panels Hub running in the background/)).toBeVisible()
  await page.screenshot({ path: 'test-results/installer-help.png' })
  await page.getByRole('button', { name: 'Install' }).click()

  // The renderer must not be able to reach Node, and only the typed bridge is exposed.
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined'
  )
  expect(
    await page.evaluate(() =>
      Object.keys((globalThis as unknown as { assetLibrary: object }).assetLibrary).sort()
    )
  ).toEqual([
    'cancelDownload',
    'getDiagnostics',
    'getEngineState',
    'getInstallProgress',
    'getInstallerStatus',
    'installPanel',
    'openLink',
    'removePanel',
    'revealLocation',
    'setStartAtLogin',
    'uninstallApp'
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

  // The menu-bar / notification-area icons are loaded from disk at runtime, at both sizes.
  const trayIconSizes = await app.evaluate(({ app: electronApp, nativeImage }) =>
    ['trayTemplate.png', 'trayTemplate@2x.png', 'tray.png', 'tray@2x.png'].map(
      (name) =>
        nativeImage.createFromPath(`${electronApp.getAppPath()}/resources/${name}`).getSize().width
    )
  )
  // Sizes are in points: the @2x files are 32 px images of a 16-point icon.
  expect(trayIconSizes).toEqual([16, 16, 16, 16])

  // Our own menu, not Electron's default (which links to Electron and opens dev tools).
  const menu = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? null
  )
  expect(menu).toEqual(
    process.platform === 'darwin' ? ['Goated Panels Hub', 'Edit', 'Window'] : null
  )

  await page.screenshot({ path: 'test-results/shell.png' })

  // Native dialogs are recorded instead of shown; `answer` is the button the test "clicks".
  await app.evaluate(({ dialog }) => {
    const seen: { message: string; detail?: string; buttons?: string[] }[] = []
    ;(globalThis as Record<string, unknown>)['dialogsSeen'] = seen
    ;(globalThis as Record<string, unknown>)['dialogAnswer'] = 1
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { message: string; detail?: string; buttons?: string[] }
      seen.push({ message: options.message, detail: options.detail, buttons: options.buttons })
      return {
        response: (globalThis as Record<string, unknown>)['dialogAnswer'] as number,
        checkboxChecked: false
      }
    }) as typeof dialog.showMessageBox
  })
  const dialogsSeen = (): Promise<{ message: string; detail?: string; buttons?: string[] }[]> =>
    app.evaluate(
      () =>
        (globalThis as Record<string, unknown>)['dialogsSeen'] as {
          message: string
          detail?: string
          buttons?: string[]
        }[]
    )

  // Quit asks first, since the panel needs the engine; "Keep running" keeps it running.
  if (process.platform === 'darwin') {
    await app.evaluate(({ Menu }) => {
      const appMenu = Menu.getApplicationMenu()?.items[0]?.submenu
      appMenu?.items.find((item) => item.label.startsWith('Quit'))?.click()
    })
    await expect.poll(async () => (await dialogsSeen()).length).toBe(1)
    const [quit] = await dialogsSeen()
    expect(quit?.message).toBe('Quit Goated Panels Hub?')
    expect(quit?.detail).toContain('Asset Library panel in Premiere Pro needs')
    expect(quit?.buttons).toEqual(['Quit', 'Keep running'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  }

  // Closing the window keeps the engine running for the Premiere panel, and says so (once).
  const before = (await dialogsSeen()).length
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0)
  await expect.poll(async () => (await dialogsSeen()).length).toBe(before + 1)
  expect((await dialogsSeen()).at(-1)?.message).toBe('Goated Panels Hub is still running')
  await new Promise((resolve) => setTimeout(resolve, 500))
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true)
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

test('runs in the background as the engine for the Premiere panel', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'asset-library-e2e-'))
  const folder = mkdtempSync(join(tmpdir(), 'asset-library-e2e-folder-'))
  const catalogDir = join(userDataDir, 'catalog')
  const app = await launch(userDataDir, '--background')
  const readJson = (name: string): Record<string, unknown> | null => {
    const file = join(catalogDir, name)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }

  // The engine reports in without opening a window.
  await expect
    .poll(() => readJson('engine.json')?.['version'], { timeout: 15_000 })
    .toBe(APP_VERSION)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)

  // A request from the panel is carried out and its result shows up in engine.json.
  mkdirSync(join(catalogDir, 'requests'), { recursive: true })
  writeFileSync(
    join(catalogDir, 'requests', 'e2e-add.json'),
    JSON.stringify({ type: 'add-folder', path: folder })
  )
  await expect
    .poll(
      () =>
        (readJson('engine.json')?.['results'] as { id: string; ok: boolean }[] | undefined)?.find(
          (result) => result.id === 'e2e-add'
        )?.ok,
      { timeout: 15_000 }
    )
    .toBe(true)
  await expect
    .poll(
      () => (readJson('catalog.json')?.['roots'] as { path: string }[] | undefined)?.[0]?.path,
      {
        timeout: 15_000
      }
    )
    .toBe(folder)
  // The panel learns which full catalog is current (and the delta's seq) from engine.json.
  await expect
    .poll(
      () =>
        (readJson('engine.json')?.['catalog'] as { generation: string } | undefined)?.generation,
      { timeout: 15_000 }
    )
    .toBe(readJson('catalog.json')?.['generation'])

  // Quitting removes engine.json, so the panel knows at once that the engine stopped.
  await app.close()
  expect(existsSync(join(catalogDir, 'engine.json'))).toBe(false)
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import http, { type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { OFFLINE_MANIFEST_URL } from './fixtures'

// Panel downloads end to end, with no network and no Premiere Pro: a local server plays GitHub
// Releases (the manifest and the panel file) and a Node script plays Adobe's plug-in installer.

const FAKE_UPIA = join(__dirname, 'fake-upia.cjs')
const panelFile = randomBytes(1_600_000)
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

let server: Server
let base = ''
let manifest = ''

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/panels-manifest.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(manifest)
      return
    }
    if (req.url === '/Asset-Library-Premiere-CEP-0.9.0.zxp') {
      // Trickled, so the window shows the download in progress.
      res.setHeader('Content-Length', String(panelFile.length))
      let offset = 0
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer)
        res.write(panelFile.subarray(offset, offset + 64 * 1024))
        offset += 64 * 1024
        if (offset >= panelFile.length) {
          clearInterval(timer)
          res.end()
        }
      }, 60)
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function writeManifest(over: Record<string, unknown> = {}): void {
  manifest = JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-16T00:00:00.000Z',
    panels: [
      {
        product: 'asset-library',
        name: 'Asset Library',
        build: 'cep',
        version: '0.9.0',
        premiere: { min: '22.0', below: null },
        url: `${base}/Asset-Library-Premiere-CEP-0.9.0.zxp`,
        size: panelFile.length,
        sha256: sha256(panelFile),
        ...over
      }
    ]
  })
}

interface FakeUpiaState {
  premiere: string[]
  cep: string[]
  uxp: string[]
  installs: { file: string; size: number; sha256: string }[]
}

function launch(
  userDataDir: string,
  stateFile: string,
  manifestUrl: string
): Promise<ElectronApplication> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const args = [`--user-data-dir=${userDataDir}`]
  const env = {
    ...process.env,
    ASSET_LIBRARY_NO_LOGIN_ITEM: '1',
    ASSET_LIBRARY_NO_PANEL_INSTALL: '1',
    ASSET_LIBRARY_NO_UPDATE_CHECK: '1',
    ASSET_LIBRARY_TEST_MANIFEST_URL: manifestUrl,
    ASSET_LIBRARY_TEST_UPIA: FAKE_UPIA,
    FAKE_UPIA_STATE: stateFile
  }
  return electron.launch(
    executablePath ? { executablePath, args, env } : { args: ['.', ...args], env }
  )
}

function setUp(state: Omit<FakeUpiaState, 'installs'>): {
  userDataDir: string
  stateFile: string
  read(): FakeUpiaState
  done(): void
} {
  const userDataDir = mkdtempSync(join(tmpdir(), 'asset-library-e2e-'))
  const stateFile = join(mkdtempSync(join(tmpdir(), 'asset-library-upia-')), 'state.json')
  writeFileSync(stateFile, JSON.stringify({ ...state, installs: [] }))
  return {
    userDataDir,
    stateFile,
    read: () => JSON.parse(readFileSync(stateFile, 'utf8')) as FakeUpiaState,
    done: () => {
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(join(stateFile, '..'), { recursive: true, force: true })
    }
  }
}

test('downloads a newer panel, verifies it and installs it', async () => {
  writeManifest()
  const fixture = setUp({ premiere: ['26.5.2'], cep: ['0.4.1'], uxp: [] })
  const app = await launch(fixture.userDataDir, fixture.stateFile, `${base}/panels-manifest.json`)
  const page = await app.firstWindow()
  const primary = page.locator('footer').getByRole('button').last()

  // The manifest has CEP 0.9.0, newer than the installed 0.4.1: an update, with its real size.
  await expect(page.getByText('Found Premiere Pro 26.5.2.')).toBeVisible({ timeout: 20_000 })
  await expect(primary).toHaveText('Update to 0.9.0')
  await expect(
    page.getByText(/Version 0\.9\.0, downloaded when you install \(1\.5 MB\)/)
  ).toBeVisible()

  // Manage says so too, without a new Hub release.
  await page.getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByText('Update available (0.9.0)')).toBeVisible()
  await page.screenshot({ path: 'test-results/installer-manage-update.png' })
  await page.getByRole('button', { name: 'Install', exact: true }).click()

  await primary.click()
  // Real progress from the bytes received, then verify and install.
  await expect(primary).toHaveText(/Downloading \d+%/, { timeout: 10_000 })
  await expect(page.getByRole('progressbar', { name: 'Download progress' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel download' })).toBeVisible()
  await page.screenshot({ path: 'test-results/installer-downloading.png' })
  await expect(primary).toHaveText('Installed', { timeout: 20_000 })
  await expect(page.getByRole('status')).toContainText('Installed the Premiere Pro panel 0.9.0')
  // What to do next, including keeping the Hub running for the panel.
  await expect(page.getByText('Installed. Next:')).toBeVisible()
  await expect(
    page.getByText('Keep Goated Panels Hub running in the background: the panel needs it.')
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/installer-download-done.png' })

  // Adobe's installer (the stand-in) got exactly the verified file, which is gone afterwards.
  const state = fixture.read()
  expect(state.installs).toHaveLength(1)
  expect(state.installs[0]?.sha256).toBe(sha256(panelFile))
  // Compared as real paths: macOS's temporary folder is reached through a link.
  const downloads = join(realpathSync(fixture.userDataDir), 'downloads')
  expect(realpathSync(join(state.installs[0]?.file ?? '', '..', '..')).startsWith(downloads)).toBe(
    true
  )
  expect(state.cep).toEqual(['0.9.0'])
  expect(existsSync(state.installs[0]?.file ?? '')).toBe(false)
  expect(readdirSync(join(fixture.userDataDir, 'downloads'))).toEqual([])

  await page.getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByText('Up to date')).toBeVisible()
  await app.close()
  fixture.done()
})

test('refuses a download that fails verification and installs nothing', async () => {
  writeManifest({ sha256: 'f'.repeat(64) })
  const fixture = setUp({ premiere: ['26.5.2'], cep: [], uxp: [] })
  const app = await launch(fixture.userDataDir, fixture.stateFile, `${base}/panels-manifest.json`)
  const page = await app.firstWindow()
  const primary = page.locator('footer').getByRole('button').last()

  await expect(primary).toHaveText('Install Asset Library', { timeout: 20_000 })
  await primary.click()
  await expect(page.getByRole('status')).toContainText("didn't match its checksum", {
    timeout: 20_000
  })
  await expect(primary).toHaveText('Try again')
  await page.screenshot({ path: 'test-results/installer-verify-failed.png' })
  expect(fixture.read().installs).toEqual([])
  expect(readdirSync(join(fixture.userDataDir, 'downloads'))).toEqual([])
  await app.close()
  fixture.done()
})

/** True when the packaged app under test carries the signed CEP panel. */
function bundlesCepPanel(executable: string): boolean {
  const resources =
    process.platform === 'darwin'
      ? join(dirname(dirname(executable)), 'Resources')
      : join(dirname(executable), 'resources')
  const panels = join(resources, 'premiere-panel')
  return existsSync(panels) && readdirSync(panels).some((name) => name.endsWith('.zxp'))
}

test('says when it is offline and falls back to the built-in panel', async () => {
  const fixture = setUp({ premiere: ['26.5.2'], cep: [], uxp: [] })
  const app = await launch(fixture.userDataDir, fixture.stateFile, OFFLINE_MANIFEST_URL)
  const page = await app.firstWindow()
  const primary = page.locator('footer').getByRole('button').last()

  await expect(
    page.getByText("You're offline, so newer panel versions can't be checked.")
  ).toBeVisible({
    timeout: 20_000
  })
  const executable = process.env['E2E_EXECUTABLE']
  if (executable && bundlesCepPanel(executable)) {
    // A build that carries the panel installs it offline from its own copy.
    await expect(
      page.getByText('Install uses the panel built into Goated Panels Hub.')
    ).toBeVisible()
    await expect(primary).toBeEnabled()
  } else if (executable) {
    // CI builds can't sign the CEP panel (no ZXPSignCmd there), so they carry only the UXP one,
    // which Premiere Pro 26 doesn't take: offline, there's nothing suitable to install.
    await expect(primary).toBeDisabled()
    await expect(page.getByRole('status')).toContainText("doesn't include the CEP build")
  } else {
    // A development build has no panel of its own: nothing to install, and it says why.
    await expect(primary).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('development copy')
  }
  await page.screenshot({ path: 'test-results/installer-offline.png' })
  await app.close()
  fixture.done()
})

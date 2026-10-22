import { describe, expect, it } from 'vitest'
import type { InstallerStatus } from '@shared/api'
import {
  buildFit,
  compareVersions,
  installedPanels,
  installState,
  recommendedBuild,
  recommendedBuilds
} from '@shared/installer'
import {
  formatBytes,
  isSelected,
  planInstall,
  type Choice
} from '../../src/renderer/src/lib/install-plan'
import {
  cepExtensionCandidates,
  installerStatus,
  premiereAppFolders
} from '../../src/main/engine/installer-status'
import { linkUrl } from '../../src/main/ipc/installer'
import { isAllowedExternalUrl } from '../../src/main/security-rules'

describe('compatibility rules', () => {
  it('recommends CEP for Premiere Pro 24 to 26 and UXP from 27, never by bigger number alone', () => {
    expect(recommendedBuild('26.5.2')).toBe('cep')
    expect(recommendedBuild('24.0')).toBe('cep')
    expect(recommendedBuild('27.0.0')).toBe('uxp')
    expect(recommendedBuild('28.1')).toBe('uxp')
    expect(recommendedBuild('23.6')).toBeNull()
  })

  it('explains how each build fits a version', () => {
    expect(buildFit('uxp', '26.5.2')).toEqual({
      fit: 'limited',
      reason: 'Opens in Premiere Pro 26.5, but dragging onto the timeline needs Premiere Pro 27.'
    })
    expect(buildFit('uxp', '25.2').fit).toBe('unsupported')
    expect(buildFit('uxp', '25.6').fit).toBe('limited')
    expect(buildFit('cep', '27.0').fit).toBe('untested')
    expect(buildFit('cep', '23.0').fit).toBe('unsupported')
  })

  it('recommends one build per version, without duplicates', () => {
    expect(recommendedBuilds(['26.5.2', '27.0.0', '27.1'])).toEqual(['uxp', 'cep'])
    expect(recommendedBuilds([])).toEqual([])
  })

  it('compares versions numerically', () => {
    expect(compareVersions('0.4.0', '0.4.1')).toBeLessThan(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })

  it('groups installed copies by build and version across Premiere versions', () => {
    const panels = installedPanels([
      { version: '26.5.2', cep: ['0.4.1'], uxp: ['0.3.24'] },
      { version: '27.0.0', cep: ['0.4.1'], uxp: [] }
    ])
    expect(panels).toEqual([
      { build: 'uxp', version: '0.3.24', premiere: ['26.5.2'] },
      { build: 'cep', version: '0.4.1', premiere: ['26.5.2', '27.0.0'] }
    ])
    expect(installState(panels, 'cep', '0.4.1')).toBe('installed')
    expect(installState(panels, 'uxp', '0.4.1')).toBe('update-available')
    expect(installState([], 'uxp', '0.4.1')).toBe('not-installed')
  })
})

const builtIn = (version: string): InstallerStatus['available']['cep'] => ({
  version,
  from: 'bundled',
  size: null
})

function status(overrides: Partial<InstallerStatus> = {}): InstallerStatus {
  return {
    appVersion: '0.1.0',
    platform: 'darwin',
    packaged: true,
    adobeInstaller: true,
    premiere: [{ version: '26.5.2', cep: [], uxp: [] }],
    bundled: { cep: '0.4.1', uxp: '0.4.1' },
    available: { cep: builtIn('0.4.1'), uxp: builtIn('0.4.1') },
    catalog: { state: 'ok', message: null },
    otherProducts: [],
    locations: { premiereApps: [], cepExtensions: [], data: '/data', cache: '/data/media' },
    ...overrides
  }
}

const plan = (
  s: InstallerStatus | null,
  choice: Choice = 'recommended',
  extra: {
    busy?: 'install' | 'remove' | null
    failed?: boolean
    app?: 'premiere' | 'after-effects'
  } = {}
): ReturnType<typeof planInstall> =>
  planInstall(s, {
    app: extra.app ?? 'premiere',
    choice,
    busy: extra.busy ?? null,
    failed: extra.failed ?? false
  })

describe('install plan', () => {
  it('installs the recommended build for the detected Premiere Pro', () => {
    const p = plan(status())
    expect(p.targets).toEqual(['cep'])
    expect(p.primary).toEqual({ state: 'install', label: 'Install Asset Library', disabled: false })
    expect(p.canUninstall).toBe(false)
  })

  it('installs exactly the overridden build', () => {
    expect(plan(status(), 'uxp').targets).toEqual(['uxp'])
  })

  it('says Installed only when every target has the bundled version', () => {
    const installed = status({ premiere: [{ version: '26.5.2', cep: ['0.4.1'], uxp: [] }] })
    expect(plan(installed).primary).toMatchObject({ state: 'installed', disabled: true })
    expect(plan(installed).canUninstall).toBe(true)
    const old = status({ premiere: [{ version: '26.5.2', cep: ['0.4.0'], uxp: [] }] })
    expect(plan(old).primary).toMatchObject({ state: 'update', label: 'Update to 0.4.1' })
  })

  it('never claims progress or success it has not seen', () => {
    expect(plan(null).primary).toMatchObject({ state: 'checking', disabled: true })
    expect(plan(status(), 'recommended', { busy: 'install' }).primary.state).toBe('installing')
    expect(plan(status(), 'recommended', { busy: 'remove' }).primary.state).toBe('uninstalling')
    expect(plan(status(), 'recommended', { failed: true }).primary).toMatchObject({
      state: 'failed',
      disabled: false
    })
  })

  it("explains why it can't install", () => {
    // A development copy carries no panel; without the download list there's nothing to install.
    expect(
      plan(status({ packaged: false, catalog: { state: 'offline', message: null } })).primary.reason
    ).toMatch(/development copy/)
    expect(plan(status({ adobeInstaller: false, premiere: [] })).primary.reason).toMatch(
      /Creative Cloud/
    )
    expect(plan(status({ premiere: [] })).primary.reason).toMatch(/Premiere Pro wasn't found/)
    expect(
      plan(status({ premiere: [{ version: '22.0', cep: [], uxp: [] }] })).primary
    ).toMatchObject({ state: 'unsupported', disabled: true })
    expect(
      plan(
        status({
          bundled: { cep: null, uxp: '0.4.1' },
          available: { cep: null, uxp: builtIn('0.4.1') },
          catalog: { state: 'offline', message: null }
        })
      ).primary
    ).toMatchObject({
      state: 'offline',
      reason: expect.stringMatching(/doesn't include the CEP build/)
    })
    expect(
      plan(status({ premiere: [{ version: '25.0', cep: [], uxp: [] }] }), 'uxp').primary
    ).toMatchObject({ state: 'unsupported' })
  })

  it('offers nothing to install for After Effects', () => {
    expect(plan(status(), 'recommended', { app: 'after-effects' }).primary).toMatchObject({
      state: 'unavailable',
      label: 'Not available yet',
      disabled: true
    })
  })

  it('installs both builds when Premiere Pro 26 and 27 are side by side', () => {
    const both = status({
      premiere: [
        { version: '26.5.2', cep: [], uxp: [] },
        { version: '27.0.0', cep: [], uxp: [] }
      ]
    })
    expect(plan(both).targets).toEqual(['uxp', 'cep'])
    expect(isSelected('recommended', ['uxp', 'cep'], 'cep')).toBe(true)
    expect(isSelected('uxp', ['uxp', 'cep'], 'cep')).toBe(false)
  })
})

describe('install plan with downloads', () => {
  const downloadable = (
    version: string,
    size = 3_565_158
  ): InstallerStatus['available']['cep'] => ({
    version,
    from: 'download',
    size
  })

  it('offers an update when the download list has a newer panel than installed', () => {
    const s = status({
      premiere: [{ version: '26.5.2', cep: ['0.4.1'], uxp: [] }],
      available: { cep: downloadable('0.5.0'), uxp: builtIn('0.4.1') }
    })
    expect(plan(s).primary).toMatchObject({ state: 'update', label: 'Update to 0.5.0' })
    expect(installState(plan(s).installed, 'cep', s.available.cep?.version ?? null)).toBe(
      'update-available'
    )
  })

  it('shows real download progress, then verifying and installing', () => {
    const s = status({ available: { cep: downloadable('0.5.0'), uxp: null } })
    const busy = (
      progress: Parameters<typeof planInstall>[1]['progress']
    ): ReturnType<typeof planInstall> =>
      planInstall(s, {
        app: 'premiere',
        choice: 'recommended',
        busy: 'install',
        failed: false,
        progress
      })
    const downloading = busy({
      phase: 'downloading',
      build: 'cep',
      version: '0.5.0',
      received: 1_500_000,
      total: 3_565_158
    })
    expect(downloading.primary).toMatchObject({
      state: 'downloading',
      label: 'Downloading 42%',
      disabled: true
    })
    expect(downloading.activity).toBe('Downloading CEP 0.5.0: 1.4 MB of 3.4 MB')
    expect(downloading.fraction).toBeCloseTo(0.42, 2)
    expect(downloading.canCancel).toBe(true)
    expect(
      busy({ phase: 'verifying', build: 'cep', version: '0.5.0', received: 1, total: 1 }).primary
        .label
    ).toBe('Verifying…')
    const installing = busy({
      phase: 'installing',
      build: null,
      version: null,
      received: 0,
      total: 0
    })
    expect(installing.primary).toMatchObject({ state: 'installing', label: 'Installing…' })
    expect(installing.canCancel).toBe(false)
    // Before main reports anything, nothing is claimed.
    expect(busy(null).primary.label).toBe('Installing…')
    expect(busy(null).fraction).toBeNull()
  })

  it('installs from a download in a development copy when the list was read', () => {
    const s = status({
      packaged: false,
      bundled: { cep: null, uxp: null },
      available: { cep: downloadable('0.5.0'), uxp: null }
    })
    expect(plan(s).primary).toMatchObject({ state: 'install', disabled: false })
  })

  it('explains a missing build by what happened to the download list', () => {
    const none = { cep: null, uxp: null }
    expect(plan(status({ available: none })).primary.reason).toBe(
      'No CEP build is available to download yet.'
    )
    expect(
      plan(
        status({
          available: none,
          catalog: {
            state: 'invalid',
            message: 'The download list needs a newer version of Goated Panels Hub.'
          }
        })
      ).primary.reason
    ).toMatch(/couldn't be used: The download list needs a newer version/)
  })

  it('formats sizes in words people know', () => {
    expect(formatBytes(512)).toBe('1 KB')
    expect(formatBytes(840 * 1024)).toBe('840 KB')
    expect(formatBytes(3_565_158)).toBe('3.4 MB')
  })
})

describe('installer status', () => {
  it('lists Premiere Pro folders that exist, on each platform', () => {
    const listDir = (dir: string): string[] =>
      dir === '/Applications'
        ? ['Adobe Premiere Pro 2026', 'Adobe After Effects 2026', 'Safari.app']
        : ['Adobe Premiere Pro 2027']
    expect(premiereAppFolders('darwin', {}, listDir)).toEqual([
      '/Applications/Adobe Premiere Pro 2026'
    ])
    expect(premiereAppFolders('win32', { ProgramFiles: 'D:\\Programs' }, listDir)).toEqual([
      'D:\\Programs\\Adobe\\Adobe Premiere Pro 2027'
    ])
    expect(
      premiereAppFolders('darwin', {}, () => {
        throw new Error('no access')
      })
    ).toEqual([])
  })

  it('knows where a CEP extension can be, per platform', () => {
    expect(cepExtensionCandidates('darwin', {}, '/Users/me')).toEqual([
      '/Users/me/Library/Application Support/Adobe/CEP/extensions/com.saxenascreation.assetlibrary.cep',
      '/Library/Application Support/Adobe/CEP/extensions/com.saxenascreation.assetlibrary.cep'
    ])
    expect(
      cepExtensionCandidates(
        'win32',
        { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
        'C:\\Users\\me'
      )[0]
    ).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.saxenascreation.assetlibrary.cep'
    )
  })

  it('reports only what it found', async () => {
    const result = await installerStatus({
      platform: 'darwin',
      env: {},
      home: '/Users/me',
      appVersion: '0.1.0',
      packaged: true,
      dataDir: '/data',
      cacheDir: '/data/media',
      inventory: async () => null,
      bundled: () => [{ kind: 'cep', version: '0.4.1' }],
      catalog: async () => ({
        state: 'offline',
        message: 'offline',
        checkedAt: 1,
        manifest: null
      }),
      sources: () => ({ cep: { from: 'bundled', version: '0.4.1' }, uxp: null }),
      otherProducts: () => [],
      exists: () => false,
      listDir: () => []
    })
    expect(result).toEqual({
      appVersion: '0.1.0',
      platform: 'darwin',
      packaged: true,
      adobeInstaller: false,
      premiere: [],
      bundled: { cep: '0.4.1', uxp: null },
      available: { cep: { version: '0.4.1', from: 'bundled', size: null }, uxp: null },
      catalog: { state: 'offline', message: 'offline' },
      otherProducts: [],
      locations: { premiereApps: [], cepExtensions: [], data: '/data', cache: '/data/media' }
    })
  })
})

describe('product links', () => {
  it('opens only configured links that pass the allowlist', () => {
    for (const link of ['repository', 'issues', 'license', 'panel-guide'] as const) {
      expect(isAllowedExternalUrl(linkUrl(link))).toBe(true)
    }
    expect(linkUrl('license')).toBe('https://github.com/saxenaxoxo/asset-library/blob/main/LICENSE')
  })
})

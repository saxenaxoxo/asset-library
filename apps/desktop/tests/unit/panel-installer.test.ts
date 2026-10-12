import { describe, expect, it, vi } from 'vitest'
import nodePath from 'path'
import {
  bundledPanelFiles,
  compareVersions,
  premiereVersions,
  wantedKinds,
  installedPanelVersions,
  installSucceeded,
  PanelInstaller,
  panelNeedsInstall,
  upiaArgs,
  upiaPath,
  upiaProblem,
  type PanelInstallerDeps,
  type UpiaRun
} from '../../src/main/engine/panel-installer'

const MAC_UPIA =
  '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent'

// Output shaped like Adobe's installer prints it: the UXP build under the product name, the CEP
// build under "<product> CEP".
const list = (
  versions: string[],
  cepVersions: string[] = [],
  premiere: string[] = ['27.0.0']
): string =>
  [
    '0 extension installed for Adobe Media Encoder (ver 26.5.2)',
    ' Status                        Extension Name                         Version',
    '=========  =======================================================  ==========',
    '',
    ...premiere.flatMap((host) => [
      `${versions.length + cepVersions.length} extensions installed for Premiere Pro (ver ${host})`,
      ' Status                        Extension Name                         Version',
      '=========  =======================================================  ==========',
      ...versions.map(
        (v) => ` Enabled    Asset Library                                               ${v}`
      ),
      ...cepVersions.map(
        (v) => ` Enabled    Asset Library CEP                                           ${v}`
      ),
      ' Enabled    Some Other Panel                                             9.9.9',
      ''
    ]),
    '0 extension installed for Others'
  ].join('\n')

describe('Adobe installer paths and arguments', () => {
  it('finds the installer on macOS and Windows', () => {
    expect(upiaPath('darwin', {})).toBe(MAC_UPIA)
    expect(upiaPath('win32', { CommonProgramFiles: 'D:\\Program Files\\Common Files' })).toBe(
      'D:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe'
    )
    expect(upiaPath('win32', {})).toMatch(/^C:\\Program Files\\Common Files\\Adobe\\/)
    expect(upiaPath('linux', {})).toBeNull()
  })

  it('uses -- flags on macOS and / flags on Windows', () => {
    expect(upiaArgs('darwin', { action: 'remove', name: 'Asset Library' })).toEqual([
      '--remove',
      'Asset Library'
    ])
    expect(upiaArgs('darwin', { action: 'install', file: '/a/p.ccx' })).toEqual([
      '--install',
      '/a/p.ccx'
    ])
    expect(upiaArgs('darwin', { action: 'list' })).toEqual(['--list', 'all'])
    expect(upiaArgs('win32', { action: 'install', file: 'C:\\p.ccx' })).toEqual([
      '/install',
      'C:\\p.ccx'
    ])
    expect(upiaArgs('win32', { action: 'remove', name: 'Asset Library' })).toEqual([
      '/remove',
      'Asset Library'
    ])
    expect(upiaArgs('win32', { action: 'list' })).toEqual(['/list', 'all'])
  })
})

describe('reading the installer output', () => {
  it('recognises a successful install', () => {
    expect(installSucceeded('Installation Successful')).toBe(true)
    expect(installSucceeded('Asset Library\r\nInstallation  successful.\r\n')).toBe(true)
    expect(installSucceeded('Installation failed. Error code -165')).toBe(false)
  })

  it('reads every installed version of our panel, ignoring other panels and the CEP build', () => {
    const both = list(['0.3.9', '0.3.14'], ['0.4.0'])
    expect(installedPanelVersions(both, 'Asset Library')).toEqual(['0.3.9', '0.3.14'])
    expect(installedPanelVersions(both, 'Asset Library CEP')).toEqual(['0.4.0'])
    expect(installedPanelVersions(list(['0.3.14']), 'Asset Library')).toEqual(['0.3.14'])
    expect(installedPanelVersions(list(['0.2.1', '0.2.2', '0.3.0']), 'Asset Library')).toEqual([
      '0.2.1',
      '0.2.2',
      '0.3.0'
    ])
    expect(installedPanelVersions('0 extension(s) installed', 'Asset Library')).toEqual([])
    expect(installedPanelVersions(list(['1.0.0']), 'Asset Lib')).toEqual([])
  })

  it('reads the Premiere Pro versions and which panel build each needs', () => {
    expect(premiereVersions(list([], [], ['26.5.2', '27.0.0']))).toEqual(['26.5.2', '27.0.0'])
    expect(premiereVersions('0 extension installed for Others')).toEqual([])
    expect([...wantedKinds(['26.5.2'])]).toEqual(['cep'])
    expect([...wantedKinds(['27.0.0'])]).toEqual(['uxp'])
    expect([...wantedKinds(['25.6.0', '27.1.0'])]).toEqual(['cep', 'uxp'])
    expect([...wantedKinds([])]).toEqual([])
  })

  it('says why it failed in one line', () => {
    expect(upiaProblem('Installing...\n\nFailed to install, status = -251\n')).toBe(
      'Failed to install, status = -251'
    )
    expect(upiaProblem('')).toBe('the installer gave no reason')
  })
})

describe('versions', () => {
  it('compares versions like 0.3.9 < 0.3.14 and releases over pre-releases', () => {
    expect(compareVersions('0.3.9', '0.3.14')).toBeLessThan(0)
    expect(compareVersions('v1.0.0', '1.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('picks the newest bundled file of each kind and ignores anything else', () => {
    expect(
      bundledPanelFiles([
        'Asset-Library-Premiere-0.3.9.ccx',
        'Asset-Library-Premiere-0.3.14.ccx',
        'Asset-Library-Premiere-CEP-0.4.0.zxp',
        'notes.txt',
        'Other-1.0.0.ccx'
      ])
    ).toEqual([
      { kind: 'cep', name: 'Asset-Library-Premiere-CEP-0.4.0.zxp', version: '0.4.0' },
      { kind: 'uxp', name: 'Asset-Library-Premiere-0.3.14.ccx', version: '0.3.14' }
    ])
    expect(bundledPanelFiles([])).toEqual([])
  })

  it('installs unless exactly the bundled version is there', () => {
    expect(panelNeedsInstall('0.3.14', ['0.3.14'])).toBe(false)
    expect(panelNeedsInstall('0.3.14', [])).toBe(true)
    expect(panelNeedsInstall('0.3.14', ['0.3.0'])).toBe(true)
    expect(panelNeedsInstall('0.3.14', ['0.3.0', '0.3.14'])).toBe(true)
  })
})

/** An installer with Adobe's agent simulated: the real one is never run in tests. */
function installer(
  options: {
    installed?: string[]
    installedCep?: string[]
    agent?: boolean
    bundled?: string[] | null
    installOutput?: string
    platform?: NodeJS.Platform
    premiere?: string[]
  } = {}
): {
  installer: PanelInstaller
  calls: string[][]
  installed: string[]
  installedCep: string[]
} {
  const installed = [...(options.installed ?? [])]
  const installedCep = [...(options.installedCep ?? [])]
  const calls: string[][] = []
  const run = vi.fn(async (_file: string, args: string[]): Promise<UpiaRun> => {
    calls.push(args)
    const [flag, value] = args
    if (flag?.endsWith('list'))
      return { ok: true, output: list(installed, installedCep, options.premiere) }
    if (flag?.endsWith('remove')) {
      ;(value === 'Asset Library CEP' ? installedCep : installed).shift()
      return { ok: true, output: 'Removal Successful' }
    }
    if (flag?.endsWith('install')) {
      const output = options.installOutput ?? 'Installation Successful'
      const file = /Premiere-(CEP-)?(.+)\.(?:ccx|zxp)$/.exec(value ?? '')
      if (installSucceeded(output) && file)
        (file[1] ? installedCep : installed).push(file[2] as string)
      return { ok: installSucceeded(output), output }
    }
    return { ok: false, output: '' }
  })
  const platform = options.platform ?? 'darwin'
  const resources = platform === 'win32' ? 'C:\\App\\resources' : '/App/resources'
  const deps: PanelInstallerDeps = {
    platform,
    env: {},
    resourcesDir: options.bundled === null ? null : resources,
    panelName: 'Asset Library',
    run,
    exists: (path) => (options.agent ?? true) && path === upiaPath(platform, {}),
    listFiles: () => options.bundled ?? ['Asset-Library-Premiere-0.3.14.ccx']
  }
  return { installer: new PanelInstaller(deps), calls, installed, installedCep }
}

describe('PanelInstaller', () => {
  it('removes every old copy before installing the bundled panel', async () => {
    const { installer: i, calls, installed } = installer({ installed: ['0.2.1', '0.3.0'] })
    const result = await i.install()
    expect(result).toEqual({
      ok: true,
      version: '0.3.14',
      message: 'Installed the Premiere Pro panel 0.3.14. Restart Premiere Pro to use it.'
    })
    expect(calls).toEqual([
      ['--list', 'all'],
      ['--remove', 'Asset Library'],
      ['--remove', 'Asset Library'],
      [
        '--install',
        nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-0.3.14.ccx')
      ],
      ['--list', 'all']
    ])
    expect(installed).toEqual(['0.3.14'])
  })

  it('uses Windows flags and paths there', async () => {
    const { installer: i, calls } = installer({ platform: 'win32' })
    expect((await i.install()).ok).toBe(true)
    expect(calls[1]).toEqual(['/remove', 'Asset Library'])
    expect(calls[2]?.[0]).toBe('/install')
    expect(calls[2]?.[1]).toMatch(/premiere-panel[\\/]Asset-Library-Premiere-0\.3\.14\.ccx$/)
  })

  it("explains when Adobe's installer or the bundled panel isn't there", async () => {
    expect((await installer({ agent: false }).installer.install()).message).toMatch(
      /Adobe's plug-in installer wasn't found/
    )
    expect((await installer({ bundled: null }).installer.install()).message).toMatch(
      /doesn't include the Premiere Pro panel/
    )
    expect((await installer({ bundled: [] }).installer.install()).ok).toBe(false)
  })

  it('reports a failed install with the reason', async () => {
    const { installer: i } = installer({
      installOutput: 'Installing extension...\nFailed to install, status = -251'
    })
    expect(await i.install()).toEqual({
      ok: false,
      message: "Couldn't install the Premiere Pro panel: Failed to install, status = -251"
    })
  })

  it('installs by itself once per new build, only when Premiere has another version', async () => {
    const record = vi.fn()
    // Already up to date: nothing runs, but it's remembered.
    const current = installer({ installed: ['0.3.14'] })
    expect(await current.installer.installIfNeeded(null, record)).toBeNull()
    expect(record).toHaveBeenLastCalledWith('uxp:0.3.14')
    expect(current.calls).toEqual([['--list', 'all']])

    // An older version installed: replaced.
    const old = installer({ installed: ['0.3.0'] })
    expect(await old.installer.installIfNeeded('0.3.0', record)).toMatchObject({ ok: true })
    expect(old.installed).toEqual(['0.3.14'])

    // Already tried for this build: never again by itself.
    const tried = installer({ installed: ['0.3.0'] })
    expect(await tried.installer.installIfNeeded('uxp:0.3.14', record)).toBeNull()
    expect(tried.calls).toEqual([])

    // Premiere isn't installed yet: try again at a later launch (nothing recorded).
    record.mockClear()
    expect(await installer({ agent: false }).installer.installIfNeeded(null, record)).toBeNull()
    expect(record).not.toHaveBeenCalled()
  })

  it('installs the build each installed Premiere Pro needs: CEP below 27, UXP from 27', async () => {
    const both = ['Asset-Library-Premiere-0.4.0.ccx', 'Asset-Library-Premiere-CEP-0.4.0.zxp']
    // Only Premiere 26: the CEP build, nothing else.
    const cepOnly = installer({ bundled: both, installed: ['0.3.24'], premiere: ['26.5.2'] })
    expect(await cepOnly.installer.install()).toMatchObject({ ok: true, version: '0.4.0' })
    expect(cepOnly.calls.filter(([flag]) => flag === '--install').map(([, f]) => f)).toEqual([
      nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-CEP-0.4.0.zxp')
    ])
    expect(cepOnly.installedCep).toEqual(['0.4.0'])
    // No Premiere at all: nothing to do, and nothing remembered.
    const none = installer({ bundled: both, premiere: [] })
    expect((await none.installer.install()).message).toMatch(/isn't installed/)
    const record = vi.fn()
    expect(await none.installer.installIfNeeded(null, record)).toBeNull()
    expect(record).not.toHaveBeenCalled()
    // Premiere 26 and 27 side by side: both builds, each under its own name.
    const {
      installer: i,
      calls,
      installed,
      installedCep
    } = installer({
      bundled: both,
      installed: ['0.3.24'],
      installedCep: [],
      premiere: ['26.5.2', '27.0.0']
    })
    expect(await i.install()).toMatchObject({ ok: true, version: '0.4.0' })
    expect(calls.filter(([flag]) => flag === '--remove')).toEqual([
      ['--remove', 'Asset Library CEP'],
      ['--remove', 'Asset Library']
    ])
    expect(calls.filter(([flag]) => flag === '--install').map(([, file]) => file)).toEqual([
      nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-CEP-0.4.0.zxp'),
      nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-0.4.0.ccx')
    ])
    expect(installed).toEqual(['0.4.0'])
    expect(installedCep).toEqual(['0.4.0'])
    // A build whose CEP panel is missing from Premiere installs by itself, too.
    const partial = installer({
      bundled: both,
      installed: ['0.4.0'],
      premiere: ['26.5.2', '27.0.0']
    })
    expect(await partial.installer.installIfNeeded(null, record)).toMatchObject({ ok: true })
    expect(record).toHaveBeenLastCalledWith('cep:0.4.0 uxp:0.4.0')
  })

  it('runs one install at a time', async () => {
    const { installer: i, calls } = installer()
    const [a, b] = await Promise.all([i.install(), i.install()])
    expect(a).toBe(b)
    expect(calls.filter(([flag]) => flag === '--install')).toHaveLength(1)
  })
})

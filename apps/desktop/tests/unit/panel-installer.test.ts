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
  premiereInventory,
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

describe('premiereInventory', () => {
  it('reports each Premiere Pro version with the panels it sees', () => {
    const output = [
      '1 extension installed for Adobe Media Encoder (ver 26.5.2)',
      ' Enabled    Asset Library                                               9.9.9',
      '2 extensions installed for Premiere Pro (ver 26.5.2)',
      ' Enabled    Asset Library CEP                                           0.4.1',
      ' Enabled    Magnific                                                    0.2.0',
      '1 extension installed for Premiere Pro (ver 27.0.0)',
      ' Enabled    Asset Library                                               0.4.1',
      '0 extension installed for Others'
    ].join('\n')
    expect(premiereInventory(output, 'Asset Library')).toEqual([
      { version: '26.5.2', cep: ['0.4.1'], uxp: [] },
      { version: '27.0.0', cep: [], uxp: ['0.4.1'] }
    ])
    expect(premiereInventory('', 'Asset Library')).toEqual([])
  })
})

describe('PanelInstaller', () => {
  it('installs exactly the build the editor chose', async () => {
    const both = ['Asset-Library-Premiere-0.4.0.ccx', 'Asset-Library-Premiere-CEP-0.4.0.zxp']
    const {
      installer: i,
      installed,
      installedCep
    } = installer({
      bundled: both,
      premiere: ['26.5.2']
    })
    // Premiere 26 would get CEP; the editor picked UXP.
    expect(await i.install(['uxp'])).toMatchObject({ ok: true, version: '0.4.0' })
    expect(installed).toEqual(['0.4.0'])
    expect(installedCep).toEqual([])
  })

  it('removes one build and leaves the other', async () => {
    const {
      installer: i,
      installed,
      installedCep
    } = installer({
      installed: ['0.4.0'],
      installedCep: ['0.4.0']
    })
    expect((await i.removeAll(['cep'])).ok).toBe(true)
    expect(installedCep).toEqual([])
    expect(installed).toEqual(['0.4.0'])
  })

  it('removes every copy of both builds when the app is uninstalled', async () => {
    const {
      installer: i,
      calls,
      installed,
      installedCep
    } = installer({
      installed: ['0.3.24'],
      installedCep: ['0.4.0', '0.3.0']
    })
    expect(await i.removeAll()).toEqual({ ok: true, message: 'Removed the Premiere Pro panel.' })
    expect(calls).toEqual([
      ['--list', 'all'],
      ['--remove', 'Asset Library CEP'],
      ['--list', 'all'],
      ['--remove', 'Asset Library CEP'],
      ['--list', 'all'],
      ['--list', 'all'],
      ['--remove', 'Asset Library'],
      ['--list', 'all']
    ])
    expect([...installed, ...installedCep]).toEqual([])
  })

  it('keeps removing while the same version is still listed (copies show once)', async () => {
    const { installer: i, installed } = installer({ installed: ['0.3.0', '0.3.0', '0.3.0'] })
    expect((await i.removeAll()).ok).toBe(true)
    expect(installed).toEqual([])
  })

  it('says how to finish by hand when a copy stays installed', async () => {
    const { installer: i } = installer({ installed: Array(7).fill('0.3.0') })
    const result = await i.removeAll()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/didn't remove the Premiere Pro panel 0\.3\.0\./)
    expect(result.message).toMatch(/Creative Cloud app/)
  })

  it("has nothing to remove without Adobe's installer", async () => {
    const { installer: i, calls } = installer({ agent: false })
    expect(await i.removeAll()).toEqual({
      ok: true,
      message: 'No Premiere Pro panel was installed.'
    })
    expect(calls).toEqual([])
  })

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
      ['--list', 'all'],
      ['--remove', 'Asset Library'],
      ['--list', 'all'],
      ['--remove', 'Asset Library'],
      ['--list', 'all'],
      [
        '--install',
        nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-0.3.14.ccx')
      ],
      ['--list', 'all']
    ])
    expect(installed).toEqual(['0.3.14'])
  })

  it('uses Windows flags and paths there', async () => {
    const { installer: i, calls } = installer({ platform: 'win32', installed: ['0.3.0'] })
    expect((await i.install()).ok).toBe(true)
    expect(calls).toContainEqual(['/remove', 'Asset Library'])
    const install = calls.find(([flag]) => flag === '/install')
    expect(install?.[1]).toMatch(/premiere-panel[\\/]Asset-Library-Premiere-0\.3\.14\.ccx$/)
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
    // Only what's installed is removed: the old UXP copy, no CEP one.
    expect(calls.filter(([flag]) => flag === '--remove')).toEqual([['--remove', 'Asset Library']])
    expect(calls.filter(([flag]) => flag === '--install').map(([, file]) => file)).toEqual([
      nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-CEP-0.4.0.zxp'),
      nodePath.join('/App/resources', 'premiere-panel', 'Asset-Library-Premiere-0.4.0.ccx')
    ])
    expect(installed).toEqual(['0.4.0'])
    expect(installedCep).toEqual(['0.4.0'])
    // A build the editor never installed isn't added at launch: that's their choice to make
    // in the installer window. Only installed builds are kept up to date.
    const partial = installer({
      bundled: both,
      installed: ['0.4.0'],
      premiere: ['26.5.2', '27.0.0']
    })
    expect(await partial.installer.installIfNeeded(null, record)).toBeNull()
    expect(record).toHaveBeenLastCalledWith('cep:0.4.0 uxp:0.4.0')
    expect(partial.calls.filter(([flag]) => flag === '--install')).toEqual([])
    const outdated = installer({ bundled: both, installed: ['0.3.24'], premiere: ['27.0.0'] })
    expect(await outdated.installer.installIfNeeded(null, record)).toMatchObject({ ok: true })
    expect(outdated.installed).toEqual(['0.4.0'])
    expect(outdated.installedCep).toEqual([])
  })

  it('runs one install at a time', async () => {
    const { installer: i, calls } = installer()
    const [a, b] = await Promise.all([i.install(), i.install()])
    expect(a).toBe(b)
    expect(calls.filter(([flag]) => flag === '--install')).toHaveLength(1)
  })
})

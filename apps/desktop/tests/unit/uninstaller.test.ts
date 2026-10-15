import { describe, expect, it, vi } from 'vitest'
import {
  cepExtensionFolder,
  macAppBundle,
  Uninstaller,
  windowsUninstaller,
  type UninstallChoice,
  type UninstallerDeps
} from '../../src/main/engine/uninstaller'

const MAC_EXEC = '/Applications/Asset Library.app/Contents/MacOS/Asset Library'
const WIN_EXEC = 'C:\\Users\\me\\AppData\\Local\\Programs\\asset-library\\Asset Library.exe'
const DATA = '/Users/me/Library/Application Support/Asset Library'
const LEGACY_DATA = '/Users/me/Library/Application Support/Asset Library (before the rename)'

describe('uninstall paths', () => {
  it('finds the app bundle of a macOS executable', () => {
    expect(macAppBundle(MAC_EXEC)).toBe('/Applications/Asset Library.app')
    expect(macAppBundle('/usr/local/bin/node')).toBeNull()
  })

  it("finds the Windows uninstaller beside the app's executable", () => {
    expect(windowsUninstaller(WIN_EXEC, 'Asset Library')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Programs\\asset-library\\Uninstall Asset Library.exe'
    )
  })

  it('knows where a hand-copied CEP extension lives', () => {
    expect(cepExtensionFolder('darwin', '/Users/me', '/unused')).toBe(
      '/Users/me/Library/Application Support/Adobe/CEP/extensions/com.saxenascreation.assetlibrary.cep'
    )
    expect(cepExtensionFolder('win32', 'C:\\Users\\me', 'C:\\Users\\me\\AppData\\Roaming')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.saxenascreation.assetlibrary.cep'
    )
    expect(cepExtensionFolder('linux', '/home/me', '/home/me/.config')).toBeNull()
  })
})

function setup(
  options: {
    platform?: NodeJS.Platform
    packaged?: boolean
    choice?: UninstallChoice
    panelsOk?: boolean
    existing?: string[]
    trashFails?: string[]
  } = {}
): { uninstaller: Uninstaller; steps: string[]; told: Parameters<UninstallerDeps['tell']>[] } {
  const steps: string[] = []
  const told: Parameters<UninstallerDeps['tell']>[] = []
  const platform = options.platform ?? 'darwin'
  const deps: UninstallerDeps = {
    platform,
    productName: 'Asset Library',
    packaged: options.packaged ?? true,
    execPath: platform === 'win32' ? WIN_EXEC : MAC_EXEC,
    dataDir: DATA,
    legacyDataDir: LEGACY_DATA,
    cepFolder: '/cep/com.saxenascreation.assetlibrary.cep',
    confirm: vi.fn(async () => {
      steps.push('confirm')
      return options.choice ?? { confirmed: true, deleteData: false }
    }),
    removePanels: async () => {
      steps.push('remove panels')
      return options.panelsOk === false
        ? { ok: false, message: 'Panel stayed.' }
        : { ok: true, message: 'Removed the Premiere Pro panel.' }
    },
    forgetSystemEntries: () => void steps.push('forget login and link'),
    stopEngine: async () => void steps.push('stop engine'),
    exists: (path) => (options.existing ?? []).includes(path),
    trash: async (path) => {
      steps.push(`trash ${path}`)
      if ((options.trashFails ?? []).includes(path)) throw new Error('no')
    },
    launch: (file, args) => void steps.push(`launch ${file} ${args.join(' ')}`.trim()),
    tell: async (...args) => {
      told.push(args)
    },
    exit: () => void steps.push('exit')
  }
  return { uninstaller: new Uninstaller(deps), steps, told }
}

describe('Uninstaller', () => {
  it("also trashes the data folder's old name when the library is deleted", async () => {
    const { uninstaller, steps } = setup({
      choice: { confirmed: true, deleteData: true },
      existing: [LEGACY_DATA]
    })
    await uninstaller.run()
    expect(steps).toContain(`trash ${DATA}`)
    expect(steps.indexOf(`trash ${LEGACY_DATA}`)).toBeGreaterThan(steps.indexOf(`trash ${DATA}`))
  })

  it("leaves the data folder's old name alone when the library is kept", async () => {
    const { uninstaller, steps } = setup({ existing: [LEGACY_DATA] })
    await uninstaller.run()
    expect(steps).not.toContain(`trash ${LEGACY_DATA}`)
  })

  it('does nothing when the editor cancels', async () => {
    const { uninstaller, steps, told } = setup({ choice: { confirmed: false, deleteData: true } })
    await uninstaller.run()
    expect(steps).toEqual(['confirm'])
    expect(told).toEqual([])
  })

  it("doesn't touch anything in a development copy", async () => {
    const { uninstaller, steps, told } = setup({ packaged: false })
    await uninstaller.run()
    expect(steps).toEqual([])
    expect(told[0]?.[1]).toBe('Nothing to uninstall')
  })

  it('on macOS removes the panel, stops the engine and moves the app to the Trash, keeping the library', async () => {
    const { uninstaller, steps, told } = setup()
    await uninstaller.run()
    expect(steps).toEqual([
      'confirm',
      'remove panels',
      'forget login and link',
      'stop engine',
      'trash /Applications/Asset Library.app',
      'exit'
    ])
    expect(told).toHaveLength(1)
    expect(told[0]?.[0]).toBe('info')
    expect(told[0]?.[1]).toBe('Asset Library was removed')
    expect(told[0]?.[2]).toContain('Restart Premiere Pro')
    expect(told[0]?.[2]).toContain(`Your library data was kept`)
  })

  it('moves the library data and a hand-copied panel to the Trash when asked', async () => {
    const { uninstaller, steps, told } = setup({
      choice: { confirmed: true, deleteData: true },
      existing: ['/cep/com.saxenascreation.assetlibrary.cep']
    })
    await uninstaller.run()
    expect(steps).toEqual([
      'confirm',
      'remove panels',
      'trash /cep/com.saxenascreation.assetlibrary.cep',
      'forget login and link',
      'stop engine',
      `trash ${DATA}`,
      'trash /Applications/Asset Library.app',
      'exit'
    ])
    expect(told[0]?.[2]).not.toContain('kept')
  })

  it('stops the engine before the data folder moves, so nothing writes into it afterwards', async () => {
    const { uninstaller, steps } = setup({ choice: { confirmed: true, deleteData: true } })
    await uninstaller.run()
    expect(steps.indexOf('stop engine')).toBeLessThan(steps.indexOf(`trash ${DATA}`))
  })

  it('says what is left to do by hand when something fails, and still quits', async () => {
    const { uninstaller, steps, told } = setup({
      panelsOk: false,
      trashFails: ['/Applications/Asset Library.app']
    })
    await uninstaller.run()
    expect(steps.at(-1)).toBe('exit')
    expect(told[0]?.[0]).toBe('warning')
    expect(told[0]?.[1]).toBe('Asset Library was partly removed')
    expect(told[0]?.[2]).toContain('Panel stayed.')
    expect(told[0]?.[2]).toContain('drag it to the Trash yourself')
  })

  it("on Windows hands over to the app's uninstaller, which deletes the data when asked", async () => {
    const uninstallerExe = windowsUninstaller(WIN_EXEC, 'Asset Library')
    const { uninstaller, steps, told } = setup({
      platform: 'win32',
      choice: { confirmed: true, deleteData: true },
      existing: [uninstallerExe]
    })
    await uninstaller.run()
    expect(steps).toEqual([
      'confirm',
      'remove panels',
      'forget login and link',
      'stop engine',
      `launch ${uninstallerExe} --delete-app-data`,
      'exit'
    ])
    expect(told).toEqual([])
  })

  it('on Windows keeps the data unless asked', async () => {
    const uninstallerExe = windowsUninstaller(WIN_EXEC, 'Asset Library')
    const { uninstaller, steps } = setup({ platform: 'win32', existing: [uninstallerExe] })
    await uninstaller.run()
    expect(steps).toContain(`launch ${uninstallerExe}`)
  })

  it('on Windows points to Settings → Apps when the uninstaller is missing', async () => {
    const { uninstaller, steps, told } = setup({ platform: 'win32' })
    await uninstaller.run()
    expect(steps.at(-1)).toBe('exit')
    expect(told[0]?.[2]).toContain('Settings → Apps')
  })

  it('ignores a second request while one is already running', async () => {
    const { uninstaller, steps } = setup()
    await Promise.all([uninstaller.run(), uninstaller.run()])
    expect(steps.filter((step) => step === 'confirm')).toHaveLength(1)
  })
})

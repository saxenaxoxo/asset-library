import { describe, expect, it } from 'vitest'
import {
  installedCopyToHandOver,
  isInstalledCopy,
  type CopyFacts
} from '../../src/main/engine/installed-copy'

const NAME = 'Goated Panels Hub'
const mac = (execPath: string, existing: string[] = []): CopyFacts => ({
  platform: 'darwin',
  packaged: true,
  execPath,
  home: '/Users/editor',
  productName: NAME,
  exists: (path) => existing.includes(path)
})
const inApps = `/Applications/${NAME}.app/Contents/MacOS/${NAME}`
const inDist = `/Users/editor/code/apps/desktop/dist/mac-arm64/${NAME}.app/Contents/MacOS/${NAME}`
const onDmg = `/Volumes/${NAME} 0.1.1-arm64/${NAME}.app/Contents/MacOS/${NAME}`

describe('which copy of the app is the installed one', () => {
  it('on macOS, only a copy in Applications', () => {
    expect(isInstalledCopy(mac(inApps))).toBe(true)
    expect(
      isInstalledCopy(mac(`/Users/editor/Applications/${NAME}.app/Contents/MacOS/${NAME}`))
    ).toBe(true)
    expect(isInstalledCopy(mac(inDist))).toBe(false)
    expect(isInstalledCopy(mac(onDmg))).toBe(false)
    // A sub-folder of Applications is still a copy the editor put there, but not the one we expect.
    expect(isInstalledCopy(mac(`/Applications/Old/${NAME}.app/Contents/MacOS/${NAME}`))).toBe(false)
  })

  it('never a development run', () => {
    expect(isInstalledCopy({ ...mac(inApps), packaged: false })).toBe(false)
  })

  it('on Windows, a copy with the installer’s uninstaller beside it', () => {
    const installed = `C:\\Users\\editor\\AppData\\Local\\Programs\\${NAME}\\${NAME}.exe`
    const facts = (execPath: string): CopyFacts => ({
      platform: 'win32',
      packaged: true,
      execPath,
      home: 'C:\\Users\\editor',
      productName: NAME,
      exists: (path) =>
        path === `C:\\Users\\editor\\AppData\\Local\\Programs\\${NAME}\\Uninstall ${NAME}.exe`
    })
    expect(isInstalledCopy(facts(installed))).toBe(true)
    expect(isInstalledCopy(facts(`D:\\build\\win-unpacked\\${NAME}.exe`))).toBe(false)
  })
})

describe('handing over to the installed copy', () => {
  it('sends a stray macOS build to the copy in Applications', () => {
    expect(installedCopyToHandOver(mac(inDist, [`/Applications/${NAME}.app`]))).toBe(
      `/Applications/${NAME}.app`
    )
    expect(installedCopyToHandOver(mac(onDmg, [`/Users/editor/Applications/${NAME}.app`]))).toBe(
      `/Users/editor/Applications/${NAME}.app`
    )
  })

  it('stays put when it is the installed copy or there is none', () => {
    expect(installedCopyToHandOver(mac(inApps, [`/Applications/${NAME}.app`]))).toBeNull()
    expect(installedCopyToHandOver(mac(inDist))).toBeNull()
    expect(
      installedCopyToHandOver({ ...mac(inDist, [`/Applications/${NAME}.app`]), packaged: false })
    ).toBeNull()
  })
})

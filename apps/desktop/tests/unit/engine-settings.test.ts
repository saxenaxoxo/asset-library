import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SettingsStore, type LoginItem } from '../../src/main/engine/settings'

let dir: string
let file: string
let os: boolean | null
let loginItem: LoginItem & { set: Mock<LoginItem['set']> }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'asset-library-settings-'))
  file = join(dir, 'settings.json')
  os = null
  loginItem = {
    set: vi.fn((enabled: boolean) => {
      os = enabled
    }),
    get: () => os
  }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const saved = (): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('SettingsStore', () => {
  it('turns start at login on the first time and records it', () => {
    const store = new SettingsStore(file, loginItem)
    store.init()
    expect(loginItem.set).toHaveBeenCalledExactlyOnceWith(true)
    expect(store.settings).toEqual({ startAtLogin: true })
    expect(saved()).toEqual({ startAtLogin: true })
  })

  it("keeps the user's later choice instead of turning it back on", () => {
    const first = new SettingsStore(file, loginItem)
    first.init()
    first.setStartAtLogin(false)
    loginItem.set.mockClear()

    const next = new SettingsStore(file, loginItem)
    next.init()
    expect(loginItem.set).not.toHaveBeenCalled()
    expect(next.settings.startAtLogin).toBe(false)
  })

  it('follows the OS when the user changed it there', () => {
    writeFileSync(file, JSON.stringify({ startAtLogin: true }))
    os = false
    const store = new SettingsStore(file, loginItem)
    store.init()
    expect(store.settings.startAtLogin).toBe(false)
    expect(saved()).toEqual({ startAtLogin: false })
  })

  it('keeps the saved value when the OS cannot tell (development builds)', () => {
    writeFileSync(file, JSON.stringify({ startAtLogin: false }))
    const store = new SettingsStore(file, loginItem)
    store.init()
    expect(store.settings.startAtLogin).toBe(false)
    expect(loginItem.set).not.toHaveBeenCalled()
  })

  it('writes the remembered choice again after the app was renamed', () => {
    writeFileSync(file, JSON.stringify({ startAtLogin: true }))
    os = false // the OS entry still names the old app, so it doesn't match this one
    const store = new SettingsStore(file, loginItem)
    store.init({ reapplyLoginItem: true })
    expect(loginItem.set).toHaveBeenCalledExactlyOnceWith(true)
    expect(store.settings.startAtLogin).toBe(true)
    expect(saved()).toEqual({ startAtLogin: true })
  })

  it('keeps "off" off when re-applying after the rename', () => {
    writeFileSync(file, JSON.stringify({ startAtLogin: false }))
    const store = new SettingsStore(file, loginItem)
    store.init({ reapplyLoginItem: true })
    expect(loginItem.set).toHaveBeenCalledExactlyOnceWith(false)
    expect(store.settings.startAtLogin).toBe(false)
  })

  it('treats a damaged file as a first run', () => {
    writeFileSync(file, '{ broken')
    const store = new SettingsStore(file, loginItem)
    store.init()
    expect(loginItem.set).toHaveBeenCalledWith(true)
    expect(saved()).toEqual({ startAtLogin: true })
  })

  it('lets the installed copy apply a choice a copy from the disk image could not', () => {
    // Opened from the disk image first: the OS entry can't be touched (get() is null).
    const fromDiskImage = new SettingsStore(file, { set: () => {}, get: () => null })
    fromDiskImage.init()
    expect(saved()).toEqual({ startAtLogin: true, loginItemPending: true })

    // Then the copy in Applications starts: the OS says "off" only because nobody set it yet.
    os = false
    loginItem.set.mockClear()
    const installed = new SettingsStore(file, loginItem)
    installed.init()
    expect(loginItem.set).toHaveBeenCalledExactlyOnceWith(true)
    expect(installed.settings.startAtLogin).toBe(true)
    expect(saved()).toEqual({ startAtLogin: true })
  })

  it('remembers that the background note was shown', () => {
    const store = new SettingsStore(file, loginItem)
    expect(store.backgroundNoteShown).toBe(false)
    store.recordBackgroundNoteShown()
    expect(new SettingsStore(file, loginItem).backgroundNoteShown).toBe(true)
  })

  it("doesn't take the OS entry as the editor's choice when the data move didn't finish", () => {
    writeFileSync(file, JSON.stringify({ startAtLogin: true }))
    os = false // the entry still names the app under its old name
    const store = new SettingsStore(file, loginItem)
    store.init({ trustLoginItem: false })
    expect(store.settings.startAtLogin).toBe(true)
    expect(saved()).toEqual({ startAtLogin: true })
  })
})

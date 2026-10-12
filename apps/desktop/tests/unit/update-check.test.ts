import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEngineStatus, parseRequest } from '@catalog/requests'
import {
  LATEST_RELEASE_URL,
  newerRelease,
  parseLatestRelease,
  UPDATE_CHECK_INTERVAL_MS,
  updateCheckDue,
  UpdateChecker
} from '../../src/main/engine/update-check'
import { SettingsStore, type AvailableUpdate } from '../../src/main/engine/settings'

const RELEASE_PAGE = 'https://github.com/saxenaxoxo/asset-library/releases/tag/v0.4.0'
const release = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  tag_name: 'v0.4.0',
  html_url: RELEASE_PAGE,
  draft: false,
  prerelease: false,
  ...over
})

describe('reading the latest release', () => {
  it('takes the version and release page', () => {
    expect(parseLatestRelease(release())).toEqual({ version: '0.4.0', url: RELEASE_PAGE })
  })

  it('ignores drafts, pre-releases, odd tags and pages outside our GitHub', () => {
    expect(parseLatestRelease(release({ draft: true }))).toBeNull()
    expect(parseLatestRelease(release({ prerelease: true }))).toBeNull()
    expect(parseLatestRelease(release({ tag_name: 'latest' }))).toBeNull()
    expect(parseLatestRelease(release({ html_url: 'https://evil.example/download' }))).toBeNull()
    expect(parseLatestRelease(null)).toBeNull()
    expect(parseLatestRelease('nope')).toBeNull()
  })

  it('only reports releases newer than the app', () => {
    const r = { version: '0.4.0', url: RELEASE_PAGE }
    expect(newerRelease(r, '0.3.9')).toEqual(r)
    expect(newerRelease(r, '0.4.0')).toBeNull()
    expect(newerRelease(r, '0.10.0')).toBeNull()
    expect(newerRelease(null, '0.1.0')).toBeNull()
  })

  it('is due once a day', () => {
    expect(updateCheckDue(null, 1000)).toBe(true)
    expect(updateCheckDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false)
    expect(updateCheckDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true)
    // A clock set back doesn't block checks forever.
    expect(updateCheckDue(5000, 1000)).toBe(true)
  })
})

describe('UpdateChecker', () => {
  let state: { lastCheckAt: number | null; latest: AvailableUpdate | null }
  let enabled: boolean
  let clock: number
  let fetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    state = { lastCheckAt: null, latest: null }
    enabled = true
    clock = 10_000_000
    fetch = vi.fn(async () => ({ ok: true, json: async () => release() }))
  })

  const checker = (): UpdateChecker =>
    new UpdateChecker({
      appVersion: '0.3.0',
      fetch: fetch as never,
      enabled: () => enabled,
      state: () => state,
      record: (at, latest) => (state = { lastCheckAt: at, latest }),
      now: () => clock
    })

  it('asks GitHub at most once a day and reports a newer release', async () => {
    const c = checker()
    await c.checkIfDue()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(LATEST_RELEASE_URL)
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
    expect(c.available()).toEqual({ version: '0.4.0', url: RELEASE_PAGE })
    clock += UPDATE_CHECK_INTERVAL_MS - 1
    await c.checkIfDue()
    expect(fetch).toHaveBeenCalledOnce()
    clock += 1
    await c.checkIfDue()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never asks when turned off, and then shows no update', async () => {
    state = { lastCheckAt: null, latest: { version: '0.4.0', url: RELEASE_PAGE } }
    enabled = false
    const c = checker()
    await c.checkIfDue()
    expect(fetch).not.toHaveBeenCalled()
    expect(c.available()).toBeNull()
  })

  it('counts a failed check (offline) and keeps what it knew', async () => {
    state = { lastCheckAt: null, latest: { version: '0.4.0', url: RELEASE_PAGE } }
    fetch.mockRejectedValueOnce(new Error('offline'))
    const c = checker()
    await expect(c.checkIfDue()).resolves.toBeUndefined()
    expect(state.lastCheckAt).toBe(clock)
    expect(c.available()?.version).toBe('0.4.0')
  })

  it('forgets an update once the app is that version or newer', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => release({ tag_name: 'v0.3.0' }) })
    const c = checker()
    await c.checkIfDue()
    expect(c.available()).toBeNull()
    expect(state.latest).toBeNull()
  })
})

describe('update settings', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'asset-library-update-settings-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('checks by default, remembers turning it off, the last check and the panel install', () => {
    const file = join(dir, 'settings.json')
    const loginItem = { set: vi.fn(), get: () => null }
    const store = new SettingsStore(file, loginItem)
    expect(store.checkForUpdates).toBe(true)
    expect(store.updateCheck).toEqual({ lastCheckAt: null, latest: null })
    store.setCheckForUpdates(false)
    store.recordUpdateCheck(42, { version: '0.4.0', url: RELEASE_PAGE })
    store.recordPanelAutoInstall('0.3.14')

    const again = new SettingsStore(file, loginItem)
    expect(again.checkForUpdates).toBe(false)
    expect(again.updateCheck).toEqual({
      lastCheckAt: 42,
      latest: { version: '0.4.0', url: RELEASE_PAGE }
    })
    expect(again.panelAutoInstalled).toBe('0.3.14')
    again.recordUpdateCheck(43, null)
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('latestRelease')
  })
})

describe('panel contract for updates', () => {
  it('accepts checkForUpdates in set-settings, alone or with startAtLogin', () => {
    expect(parseRequest('{"type":"set-settings","checkForUpdates":false}')).toEqual({
      type: 'set-settings',
      checkForUpdates: false
    })
    expect(
      parseRequest('{"type":"set-settings","startAtLogin":true,"checkForUpdates":true}')
    ).toEqual({ type: 'set-settings', startAtLogin: true, checkForUpdates: true })
    expect(parseRequest('{"type":"set-settings"}')).toEqual({ type: 'set-settings' })
    expect(parseRequest('{"type":"set-settings","checkForUpdates":"yes"}')).toBeNull()
  })

  it('reads the update and the setting from engine.json, and older files without them', () => {
    const base = { version: '0.4.0', updatedAt: 1 }
    expect(
      parseEngineStatus(
        JSON.stringify({
          ...base,
          settings: { startAtLogin: true, checkForUpdates: false },
          update: { version: '0.5.0', url: RELEASE_PAGE }
        })
      )
    ).toMatchObject({
      settings: { startAtLogin: true, checkForUpdates: false },
      update: { version: '0.5.0', url: RELEASE_PAGE }
    })
    expect(parseEngineStatus(JSON.stringify(base))).not.toHaveProperty('update')
    expect(
      parseEngineStatus(JSON.stringify({ ...base, update: { version: 5 } }))
    ).not.toHaveProperty('update')
  })
})

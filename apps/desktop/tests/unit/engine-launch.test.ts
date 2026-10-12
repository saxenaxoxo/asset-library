import { describe, expect, it } from 'vitest'
import { ENGINE_START_URL } from '@catalog/requests'
import {
  ENGINE_SCHEME,
  engineUrlAction,
  engineUrlInArgv,
  startsInBackground
} from '../../src/main/engine/launch'

describe('engine URLs', () => {
  it('uses the scheme the panel opens', () => {
    expect(ENGINE_SCHEME).toBe('assetlibrary')
    expect(engineUrlAction(ENGINE_START_URL)).toBe('start')
  })

  it('understands start and open, and nothing else', () => {
    expect(engineUrlAction('assetlibrary://start/')).toBe('start')
    expect(engineUrlAction('ASSETLIBRARY://Open')).toBe('open')
    expect(engineUrlAction('assetlibrary://delete-everything')).toBeNull()
    expect(engineUrlAction('https://start')).toBeNull()
    expect(engineUrlAction('not a url')).toBeNull()
  })

  it('finds the URL Windows passes on the command line', () => {
    expect(engineUrlInArgv(['C:\\App\\Asset Library.exe', 'assetlibrary://start'])).toBe(
      'assetlibrary://start'
    )
    expect(engineUrlInArgv(['app', '--background'])).toBeNull()
  })
})

describe('startsInBackground', () => {
  const app = ['/Applications/Asset Library.app/Contents/MacOS/Asset Library']

  it('shows the window for a normal launch', () => {
    expect(startsInBackground({ argv: app, openedAtLogin: false, url: null })).toBe(false)
    expect(
      startsInBackground({ argv: app, openedAtLogin: false, url: 'assetlibrary://open' })
    ).toBe(false)
  })

  it('stays in the background at login, with --background, or when the panel starts it', () => {
    expect(startsInBackground({ argv: app, openedAtLogin: true, url: null })).toBe(true)
    expect(
      startsInBackground({ argv: [...app, '--background'], openedAtLogin: false, url: null })
    ).toBe(true)
    expect(startsInBackground({ argv: app, openedAtLogin: false, url: ENGINE_START_URL })).toBe(
      true
    )
    expect(
      startsInBackground({ argv: [...app, ENGINE_START_URL], openedAtLogin: false, url: null })
    ).toBe(true)
  })
})

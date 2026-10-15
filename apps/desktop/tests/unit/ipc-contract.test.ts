import { describe, expect, it } from 'vitest'
import { IpcChannel } from '@shared/channels'
import { ipcContract } from '@shared/schemas'

describe('IPC contract', () => {
  it('has request and response schemas for every channel', () => {
    for (const channel of Object.values(IpcChannel)) {
      expect(ipcContract[channel]).toBeDefined()
      expect(ipcContract[channel].request).toBeDefined()
      expect(ipcContract[channel].response).toBeDefined()
    }
  })

  it('has no schemas for channels that do not exist', () => {
    expect(Object.keys(ipcContract).sort()).toEqual(Object.values(IpcChannel).sort())
  })

  it('rejects payloads on argument-free channels', () => {
    expect(() => ipcContract[IpcChannel.uninstallApp].request.parse({ path: '/etc' })).toThrow()
    expect(ipcContract[IpcChannel.getInstallerStatus].request.parse(undefined)).toBeUndefined()
  })

  it('only accepts named folders and links, never paths or URLs, from the window', () => {
    const reveal = ipcContract[IpcChannel.revealLocation].request
    expect(reveal.parse({ target: 'data' })).toEqual({ target: 'data', index: 0 })
    expect(() => reveal.parse({ target: '/Users/someone/secret' })).toThrow()
    expect(() => reveal.parse({ target: 'cache', index: 1000 })).toThrow()
    const link = ipcContract[IpcChannel.openLink].request
    expect(() => link.parse({ link: 'https://example.com' })).toThrow()
  })

  it('only accepts known panel builds', () => {
    const install = ipcContract[IpcChannel.installPanel].request
    expect(install.parse({ builds: ['uxp'] })).toEqual({ builds: ['uxp'] })
    expect(() => install.parse({ builds: ['../../evil'] })).toThrow()
    expect(() => ipcContract[IpcChannel.removePanel].request.parse({})).toThrow()
  })
})

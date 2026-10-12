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
    expect(() => ipcContract[IpcChannel.pickFolder].request.parse({ path: '/etc' })).toThrow()
    expect(ipcContract[IpcChannel.pickFolder].request.parse(undefined)).toBeUndefined()
  })

  it('validates app info responses', () => {
    const schema = ipcContract[IpcChannel.getAppInfo].response
    expect(
      schema.parse({ name: 'Asset Library', version: '0.1.0', platform: 'darwin' })
    ).toBeTruthy()
    expect(() =>
      schema.parse({ name: 'Asset Library', version: '0.1.0', platform: 'beos' })
    ).toThrow()
  })

  it('accepts a picked folder or null, nothing else', () => {
    const schema = ipcContract[IpcChannel.pickFolder].response
    expect(schema.parse(null)).toBeNull()
    expect(schema.parse({ path: '/Volumes/SSD/Overlays' })).toEqual({
      path: '/Volumes/SSD/Overlays'
    })
    expect(() => schema.parse({ path: '' })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { IpcChannel } from '@shared/channels'
import { ipcContract } from '@shared/schemas'

const UUID = '8b1f5c3e-2a4d-4e6f-9a1b-3c5d7e9f0a2b'

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
    expect(() => ipcContract[IpcChannel.addFolder].request.parse({ path: '/etc' })).toThrow()
    expect(ipcContract[IpcChannel.getCounts].request.parse(undefined)).toBeUndefined()
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

  it('only accepts asset IDs, never paths, for asset actions', () => {
    const reveal = ipcContract[IpcChannel.revealAsset].request
    expect(reveal.parse({ id: UUID })).toEqual({ id: UUID })
    expect(() => reveal.parse({ id: '/Users/someone/secret.mov' })).toThrow()
    const drag = ipcContract[IpcChannel.startDrag].request
    expect(() => drag.parse({ ids: ['../../etc/passwd'] })).toThrow()
    expect(() => drag.parse({ ids: [] })).toThrow()
  })

  it('bounds queries so the UI cannot request unlimited rows', () => {
    const query = ipcContract[IpcChannel.queryAssets].request
    expect(query.parse({ text: 'whoosh', kind: 'audio', limit: 200 })).toBeTruthy()
    expect(() => query.parse({ limit: 100000 })).toThrow()
    expect(() => query.parse({ kind: 'executable' })).toThrow()
    expect(() => query.parse({ text: 'x'.repeat(500) })).toThrow()
  })

  it('trims tag names and rejects empty ones', () => {
    const tag = ipcContract[IpcChannel.addTag].request
    expect(tag.parse({ id: UUID, name: '  flares ' })).toEqual({ id: UUID, name: 'flares' })
    expect(() => tag.parse({ id: UUID, name: '   ' })).toThrow()
  })
})

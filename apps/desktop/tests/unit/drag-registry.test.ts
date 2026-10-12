import { describe, expect, it } from 'vitest'
import { DragRegistry } from '../../src/main/drag/registry'

describe('DragRegistry', () => {
  it('resolves registered IDs to their paths, in order', () => {
    const registry = new DragRegistry()
    const a = registry.register('/Volumes/SSD/Overlays/light-leak.mov')
    const b = registry.register('/Volumes/SSD/SFX/whoosh.wav')
    expect(registry.resolve([b, a])).toEqual([
      '/Volumes/SSD/SFX/whoosh.wav',
      '/Volumes/SSD/Overlays/light-leak.mov'
    ])
  })

  it('ignores IDs it never issued, so the renderer cannot name arbitrary paths', () => {
    const registry = new DragRegistry()
    registry.register('/Volumes/SSD/a.mp4')
    expect(registry.resolve(['/etc/passwd', 'made-up-id'])).toEqual([])
  })

  it('issues unique IDs even for the same path', () => {
    const registry = new DragRegistry()
    expect(registry.register('/x.mp4')).not.toBe(registry.register('/x.mp4'))
  })
})

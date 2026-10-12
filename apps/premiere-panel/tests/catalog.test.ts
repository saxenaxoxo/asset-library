import { describe, expect, it } from 'vitest'
import { catalogPath, CATALOG_VERSION, parseCatalog, type CatalogAsset } from '@catalog/types'
import { filterAssets, formatDuration } from '@catalog/filter'

function asset(name: string, overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: name,
    name,
    kind: 'video',
    path: `/Volumes/SSD/${name}`,
    folder: '',
    root: 'SSD',
    durationMs: 1000,
    width: 1920,
    height: 1080,
    fps: 25,
    hasAlpha: false,
    favorite: false,
    tags: [],
    addedAt: 0,
    thumb: null,
    sprite: null,
    preview: null,
    wave: null,
    ...overrides
  }
}

const assets = [
  asset('Glitch 04.mov', { folder: 'Glitch Transitions', addedAt: 3, tags: ['fast'] }),
  asset('Whoosh Big.wav', {
    kind: 'audio',
    folder: 'SFX',
    addedAt: 2,
    favorite: true,
    durationMs: 4000
  }),
  asset('Paper.png', { kind: 'image', folder: 'Textures', addedAt: 1 }),
  asset('Glitch 10.mov', { folder: 'Glitch Transitions', addedAt: 4 })
]

describe('filterAssets', () => {
  it('matches every word across name, folder and tags', () => {
    expect(filterAssets(assets, { text: 'glitch trans' }).map((a) => a.name)).toEqual([
      'Glitch 10.mov',
      'Glitch 04.mov'
    ])
    expect(filterAssets(assets, { text: 'FAST' }).map((a) => a.name)).toEqual(['Glitch 04.mov'])
  })

  it('filters by kind and favorites', () => {
    expect(filterAssets(assets, { kind: 'audio' })).toHaveLength(1)
    expect(filterAssets(assets, { favoritesOnly: true }).map((a) => a.name)).toEqual([
      'Whoosh Big.wav'
    ])
  })

  it('sorts newest first by default, naturally by name on request', () => {
    expect(filterAssets(assets, {}).map((a) => a.addedAt)).toEqual([4, 3, 2, 1])
    expect(filterAssets(assets, { text: 'glitch', sort: 'name' }).map((a) => a.name)).toEqual([
      'Glitch 04.mov',
      'Glitch 10.mov'
    ])
  })
})

describe('parseCatalog', () => {
  const valid = JSON.stringify({
    version: CATALOG_VERSION,
    updatedAt: 1,
    app: '0.1.0',
    roots: [],
    tags: [],
    assets: []
  })

  it('accepts the current version', () => {
    expect(parseCatalog(valid).version).toBe(CATALOG_VERSION)
  })

  it('explains damaged, foreign and too-new files', () => {
    expect(() => parseCatalog('{nope')).toThrow(/damaged/)
    expect(() => parseCatalog('{"hello":1}')).toThrow(/not an Asset Library catalog/)
    expect(() =>
      parseCatalog(JSON.stringify({ version: CATALOG_VERSION + 1, assets: [] }))
    ).toThrow(/newer/)
  })
})

describe('catalogPath', () => {
  it('matches where the desktop app writes it', () => {
    expect(catalogPath('darwin', '/Users/ed')).toBe(
      '/Users/ed/Library/Application Support/Asset Library/catalog/catalog.json'
    )
    expect(catalogPath('win32', 'C:\\Users\\ed')).toBe(
      'C:\\Users\\ed\\AppData\\Roaming\\Asset Library\\catalog\\catalog.json'
    )
  })
})

describe('formatDuration', () => {
  it('formats short and long durations', () => {
    expect(formatDuration(4004)).toBe('0:04')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(formatDuration(null)).toBeNull()
  })
})

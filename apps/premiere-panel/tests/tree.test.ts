import { describe, expect, it } from 'vitest'
import type { Catalog, CatalogAsset } from '@catalog/types'
import {
  ALL_KEY,
  buildFolderTree,
  FAVORITES_KEY,
  findFolder,
  folderKey,
  folderTrail,
  inFolder,
  tagKey
} from '@catalog/tree'
import {
  numberedName,
  parseEngineStatus,
  parseRequest,
  requestId,
  ENGINE_STALE_MS
} from '@catalog/requests'

function asset(id: string, folder: string, overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id,
    name: `${id}.mov`,
    kind: 'video',
    path: `/SSD/${folder}/${id}.mov`,
    folder,
    root: 'SSD',
    rootId: 1,
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

const catalog: Catalog = {
  version: 1,
  updatedAt: 1,
  app: '0.1.0',
  roots: [
    { id: 1, label: 'SSD', online: true },
    { id: 2, label: 'Archive', online: false }
  ],
  tags: ['glitch'],
  assets: [
    asset('a', 'Transitions/Glitch', { tags: ['Glitch'] }),
    asset('b', 'Transitions'),
    asset('c', 'transitions 10'),
    asset('d', 'transitions 2', { favorite: true }),
    asset('e', '')
  ]
}

describe('buildFolderTree', () => {
  it('nests folders under their library folder, with counts that include subfolders', () => {
    const tree = buildFolderTree(catalog)
    expect(tree.map((n) => n.label)).toEqual(['Archive', 'SSD'])
    const ssd = tree[1]!
    expect(ssd.count).toBe(5)
    const transitions = findFolder(tree, folderKey(1, 'Transitions'))!
    expect(transitions.count).toBe(2)
    expect(transitions.children.map((n) => n.label)).toEqual(['Glitch'])
    expect(transitions.children[0]!.depth).toBe(2)
  })

  it('sorts folder names the way people expect (2 before 10, case-insensitive)', () => {
    const ssd = buildFolderTree(catalog)[1]!
    expect(ssd.children.map((n) => n.label)).toEqual([
      'Transitions',
      'transitions 2',
      'transitions 10'
    ])
  })

  it('keeps library folders that are offline or empty, marked offline', () => {
    const archive = buildFolderTree(catalog)[0]!
    expect(archive).toMatchObject({ label: 'Archive', count: 0, online: false })
  })

  it('places assets from older catalogs (no rootId) by their library name', () => {
    const old = { ...catalog, assets: [asset('x', 'SFX', { rootId: undefined })] }
    expect(findFolder(buildFolderTree(old), folderKey(1, 'SFX'))?.count).toBe(1)
  })
})

describe('inFolder and folderTrail', () => {
  it('includes everything below a folder, but not folders that only share a prefix', () => {
    const inTransitions = catalog.assets.filter((a) =>
      inFolder(a, catalog, folderKey(1, 'Transitions'))
    )
    expect(inTransitions.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('handles All, Favorites and tags (case-insensitive)', () => {
    expect(catalog.assets.filter((a) => inFolder(a, catalog, ALL_KEY))).toHaveLength(5)
    expect(
      catalog.assets.filter((a) => inFolder(a, catalog, FAVORITES_KEY)).map((a) => a.id)
    ).toEqual(['d'])
    expect(
      catalog.assets.filter((a) => inFolder(a, catalog, tagKey('glitch'))).map((a) => a.id)
    ).toEqual(['a'])
  })

  it('gives the breadcrumb from the library folder down', () => {
    const trail = folderTrail(buildFolderTree(catalog), folderKey(1, 'Transitions/Glitch'))
    expect(trail.map((n) => n.label)).toEqual(['SSD', 'Transitions', 'Glitch'])
  })
})

describe('panel requests', () => {
  const id = '462f9058-d951-44ef-b24d-03b4daf269af'

  it('accepts every well-formed request', () => {
    expect(parseRequest(JSON.stringify({ type: 'add-folder', path: '/SSD/Pack' }))).toEqual({
      type: 'add-folder',
      path: '/SSD/Pack'
    })
    expect(parseRequest(JSON.stringify({ type: 'set-favorite', id, favorite: true }))).toEqual({
      type: 'set-favorite',
      id,
      favorite: true
    })
    expect(parseRequest(JSON.stringify({ type: 'add-tag', id, tag: '  glitch ' }))).toEqual({
      type: 'add-tag',
      id,
      tag: 'glitch'
    })
    expect(parseRequest(JSON.stringify({ type: 'rescan' }))).toEqual({ type: 'rescan' })
    expect(
      parseRequest(
        JSON.stringify({ type: 'import-files', files: ['/a.mov'], rootId: 1, folder: 'SFX' })
      )
    ).toEqual({ type: 'import-files', files: ['/a.mov'], rootId: 1, folder: 'SFX' })
    expect(parseRequest(JSON.stringify({ type: 'clear-cache' }))).toEqual({ type: 'clear-cache' })
  })

  it('rejects malformed requests instead of guessing', () => {
    expect(parseRequest('not json')).toBeNull()
    expect(parseRequest(JSON.stringify({ type: 'delete-everything' }))).toBeNull()
    expect(
      parseRequest(JSON.stringify({ type: 'set-favorite', id: '../x', favorite: true }))
    ).toBeNull()
    expect(parseRequest(JSON.stringify({ type: 'add-tag', id, tag: '   ' }))).toBeNull()
    expect(parseRequest(JSON.stringify({ type: 'import-files', files: [] }))).toBeNull()
    expect(parseRequest(JSON.stringify({ type: 'remove-folder', rootId: -1 }))).toBeNull()
  })

  it('reads engine status, filling gaps from older engines', () => {
    const status = parseEngineStatus(JSON.stringify({ version: '0.1.0', updatedAt: 5 }))
    expect(status).toMatchObject({
      version: '0.1.0',
      results: [],
      settings: { startAtLogin: true }
    })
    expect(parseEngineStatus('{}')).toBeNull()
    expect(ENGINE_STALE_MS).toBeGreaterThan(3000)
  })

  it('makes unique ids and numbered copy names', () => {
    expect(requestId(1, 0.1)).not.toBe(requestId(1, 0.2))
    expect(numberedName('Whoosh.wav', 2)).toBe('Whoosh 2.wav')
    expect(numberedName('README', 3)).toBe('README 3')
  })
})

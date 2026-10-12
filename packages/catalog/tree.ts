// The folder tree the panel's Folders view shows, built from the catalog. Pure and unit-tested.
import type { Catalog, CatalogAsset } from './types'

export interface FolderNode {
  /** Stable key: `${rootId}/` for a library folder, `${rootId}/Sub/Folder` below it. */
  key: string
  rootId: number
  /** Folder path inside the library folder, with "/" separators ('' for the library folder). */
  path: string
  label: string
  depth: number
  /** Assets in this folder and everything below it. */
  count: number
  online: boolean
  children: FolderNode[]
}

/** Pseudo-folders shown above the library folders. */
export const ALL_KEY = '*'
export const FAVORITES_KEY = '*favorites'
/** `*tag:glitch` shows everything tagged "glitch". */
export const TAG_PREFIX = '*tag:'

export function tagKey(tag: string): string {
  return `${TAG_PREFIX}${tag}`
}

export function folderKey(rootId: number, path: string): string {
  return `${rootId}/${path}`
}

/** Which library folder an asset belongs to (older catalogs only name it by label). */
export function assetRootId(asset: CatalogAsset, catalog: Catalog): number | null {
  if (typeof asset.rootId === 'number') return asset.rootId
  return catalog.roots.find((root) => root.label === asset.root)?.id ?? null
}

const byName = (a: FolderNode, b: FolderNode): number =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })

/** Library folders, each with its subfolders, sorted by name; counts include subfolders. */
export function buildFolderTree(catalog: Catalog): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  for (const root of catalog.roots) {
    const node: FolderNode = {
      key: folderKey(root.id, ''),
      rootId: root.id,
      path: '',
      label: root.label,
      depth: 0,
      count: 0,
      online: root.online,
      children: []
    }
    nodes.set(node.key, node)
    roots.push(node)
  }
  for (const asset of catalog.assets) {
    const rootId = assetRootId(asset, catalog)
    if (rootId === null) continue
    const rootNode = nodes.get(folderKey(rootId, ''))
    if (!rootNode) continue
    rootNode.count++
    let parent = rootNode
    let path = ''
    for (const part of asset.folder ? asset.folder.split('/') : []) {
      path = path ? `${path}/${part}` : part
      const key = folderKey(rootId, path)
      let node = nodes.get(key)
      if (!node) {
        node = {
          key,
          rootId,
          path,
          label: part,
          depth: parent.depth + 1,
          count: 0,
          online: rootNode.online,
          children: []
        }
        nodes.set(key, node)
        parent.children.push(node)
      }
      node.count++
      parent = node
    }
  }
  const sort = (list: FolderNode[]): void => {
    list.sort(byName)
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}

/** Finds a node by key anywhere in the tree. */
export function findFolder(tree: FolderNode[], key: string): FolderNode | null {
  for (const node of tree) {
    if (node.key === key) return node
    const found = findFolder(node.children, key)
    if (found) return found
  }
  return null
}

/** The chain from a library folder down to `key`, for the breadcrumb. */
export function folderTrail(tree: FolderNode[], key: string): FolderNode[] {
  for (const node of tree) {
    if (node.key === key) return [node]
    const below = folderTrail(node.children, key)
    if (below.length > 0) return [node, ...below]
  }
  return []
}

/** Whether an asset sits in the folder `key` or anywhere below it. */
export function inFolder(asset: CatalogAsset, catalog: Catalog, key: string): boolean {
  if (key === ALL_KEY) return true
  if (key === FAVORITES_KEY) return asset.favorite
  if (key.startsWith(TAG_PREFIX)) {
    const tag = key.slice(TAG_PREFIX.length).toLowerCase()
    return asset.tags.some((t) => t.toLowerCase() === tag)
  }
  const slash = key.indexOf('/')
  const rootId = Number(key.slice(0, slash))
  const path = key.slice(slash + 1)
  if (assetRootId(asset, catalog) !== rootId) return false
  return path === '' || asset.folder === path || asset.folder.startsWith(`${path}/`)
}

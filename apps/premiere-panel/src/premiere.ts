// Everything that talks to Premiere Pro. Kept small so it's easy to verify in the host.
import type { FolderItem, ProjectItem } from '@adobe/premierepro'
import type { CatalogAsset } from '@catalog/types'
import { detectWindows } from './host'
import { samePath } from './paths'

const ppro = require('premierepro')
const BIN_NAME = 'Asset Library'
const WINDOWS = detectWindows()

/** A problem the editor can fix (shown as-is in the panel). */
export class UserError extends Error {}

export interface InsertOptions {
  /** 0-based: 0 = V1. An index past the last track makes Premiere add a track. */
  videoTrack: number
  audioTrack: number
  mode: 'overwrite' | 'insert'
}

async function findBin(root: FolderItem): Promise<FolderItem | null> {
  for (const item of await root.getItems()) {
    if (item.name !== BIN_NAME) continue
    const folder = ppro.FolderItem.cast(item)
    if (folder) return folder
  }
  return null
}

async function getOrCreateBin(): Promise<FolderItem> {
  const project = await ppro.Project.getActiveProject()
  const root = await project.getRootItem()
  const existing = await findBin(root)
  if (existing) return existing
  project.lockedAccess(() => {
    project.executeTransaction((compound) => {
      compound.addAction(root.createBinAction(BIN_NAME, false))
    }, 'Create Asset Library bin')
  })
  const created = await findBin(root)
  if (!created) throw new Error('Could not create the Asset Library bin.')
  return created
}

/** Project item IDs this panel imported, by original path (so a retry never imports twice). */
const importedIds = new Map<string, string>()

function itemId(item: ProjectItem): string | null {
  try {
    return item.getId() || null
  } catch {
    return null
  }
}

async function clipsIn(bin: FolderItem): Promise<ProjectItem[]> {
  return (await bin.getItems()).filter((item) => {
    try {
      return !!ppro.ClipProjectItem.cast(item)
    } catch {
      return false // folders and other non-clip items
    }
  })
}

async function matchesPath(item: ProjectItem, path: string): Promise<boolean> {
  try {
    const clip = ppro.ClipProjectItem.cast(item)
    return !!clip && samePath(await clip.getMediaFilePath(), path, WINDOWS)
  } catch {
    return false // not a media clip (e.g. a sequence)
  }
}

async function findClip(bin: FolderItem, path: string): Promise<ProjectItem | null> {
  const clips = await clipsIn(bin)
  const knownId = importedIds.get(path)
  if (knownId) {
    const known = clips.find((item) => itemId(item) === knownId)
    if (known) return known
  }
  for (const item of clips) {
    if (await matchesPath(item, path)) return item
  }
  return null
}

/** Imports an original once into the "Asset Library" bin and returns its project item. */
export async function importOnce(asset: CatalogAsset): Promise<ProjectItem> {
  const project = await ppro.Project.getActiveProject()
  if (!project) throw new UserError('Open a project in Premiere Pro first.')
  const bin = await getOrCreateBin()
  const existing = await findClip(bin, asset.path)
  if (existing) return existing

  // Note what's in the bin first, so the new clip can be told apart even if Premiere reports
  // its path differently (case, slashes, Unicode form).
  const before = await clipsIn(bin)
  const beforeIds = new Set(before.map(itemId))
  const ok = await project.importFiles([asset.path], true, ppro.ProjectItem.cast(bin), false)
  if (!ok)
    throw new UserError(
      `Premiere couldn't import ${asset.name}. Check that the drive is connected.`
    )
  const after = await clipsIn(bin)
  const added = after.filter((item) => {
    const id = itemId(item)
    return id ? !beforeIds.has(id) : !before.includes(item)
  })
  let imported: ProjectItem | null = null
  for (const item of added) {
    if (await matchesPath(item, asset.path)) {
      imported = item
      break
    }
  }
  imported ??= added.length === 1 ? (added[0] ?? null) : await findClip(bin, asset.path)
  if (!imported) throw new Error(`Imported ${asset.name}, but couldn't find it in the bin.`)
  const id = itemId(imported)
  if (id) importedIds.set(asset.path, id)
  return imported
}

/** Imports (if needed) and places the asset at the playhead of the active sequence. */
export async function insertAtPlayhead(
  asset: CatalogAsset,
  options: InsertOptions
): Promise<string> {
  const project = await ppro.Project.getActiveProject()
  if (!project) throw new UserError('Open a project in Premiere Pro first.')
  const sequence = await project.getActiveSequence()
  if (!sequence) throw new UserError('Open a sequence, then try again.')
  const editor = ppro.SequenceEditor.getEditor(sequence)

  if (asset.name.toLowerCase().endsWith('.mogrt')) {
    const time = await sequence.getPlayerPosition()
    let added: unknown = null
    project.lockedAccess(() => {
      added = editor.insertMogrtFromPath(asset.path, time, options.videoTrack, options.audioTrack)
    })
    if (!added || (Array.isArray(added) && added.length === 0))
      throw new UserError(
        `Premiere couldn't add ${asset.name}. Check that the template opens in Premiere and the target track isn't locked.`
      )
    return `Added ${asset.name} at the playhead.`
  }
  if (asset.kind === 'template') {
    throw new UserError(
      `${asset.name} can't be placed on a timeline. Use Reveal in the Asset Library app.`
    )
  }

  const item = await importOnce(asset)
  // Read the playhead right before editing; it can be stale if read earlier.
  const time = await sequence.getPlayerPosition()
  let ok = false
  project.lockedAccess(() => {
    ok = project.executeTransaction((compound) => {
      compound.addAction(
        options.mode === 'insert'
          ? editor.createInsertProjectItemAction(
              item,
              time,
              options.videoTrack,
              options.audioTrack,
              true
            )
          : editor.createOverwriteItemAction(item, time, options.videoTrack, options.audioTrack)
      )
    }, `Add ${asset.name}`)
  })
  if (!ok)
    throw new UserError(
      `Premiere didn't accept the edit. Check that the target track isn't locked.`
    )
  return `${options.mode === 'insert' ? 'Inserted' : 'Placed'} ${asset.name} at the playhead.`
}

/** Imports into the project without touching the timeline. */
export async function importOnly(asset: CatalogAsset): Promise<string> {
  if (asset.kind === 'template' && !asset.name.toLowerCase().endsWith('.mogrt')) {
    throw new UserError(`${asset.name} can't be imported into Premiere Pro.`)
  }
  await importOnce(asset)
  return `Imported ${asset.name} into the Asset Library bin.`
}

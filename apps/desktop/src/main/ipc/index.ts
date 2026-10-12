import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { basename } from 'path'
import dragIconPath from '../../../resources/drag-icon.png?asset'
import { IpcChannel } from '@shared/channels'
import { handle, listen, type SenderCheck } from './handle'
import { DragRegistry } from '../drag/registry'
import type { WorkerClient } from '../worker/client'
import type { MediaBinaries } from '../media/binaries'
import { databaseCapabilities, type LibraryDatabase } from '../library/database'
import type { LibraryRepository } from '../library/repository'
import type { LibraryService } from '../library/service'

export interface IpcDependencies {
  db: LibraryDatabase
  repo: LibraryRepository
  library: LibraryService
  worker: WorkerClient
  binaries: MediaBinaries
}

function openDialog(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}

export function registerIpcHandlers(
  isTrustedSender: SenderCheck,
  { db, repo, library, worker, binaries }: IpcDependencies
): void {
  const dragRegistry = new DragRegistry()
  const dragIcon = nativeImage.createFromPath(dragIconPath)

  handle(IpcChannel.getAppInfo, isTrustedSender, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux'
  }))

  handle(IpcChannel.getDiagnostics, isTrustedSender, async () => {
    const ffprobeVersion = await worker
      .request({ type: 'ffprobe-version', ffprobePath: binaries.ffprobe })
      .catch(() => null)
    return { ...databaseCapabilities(db), ffprobeVersion }
  })

  // ── Library folders ──────────────────────────────────────────────────────
  handle(IpcChannel.listRoots, isTrustedSender, async () => repo.listRoots())

  handle(IpcChannel.addFolder, isTrustedSender, async (_request, event) => {
    const result = await openDialog(event, {
      title: 'Add a library folder',
      buttonLabel: 'Add folder',
      properties: ['openDirectory']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return library.addRoot(path)
  })

  handle(IpcChannel.removeRoot, isTrustedSender, async ({ id }) => library.removeRoot(id))

  handle(IpcChannel.rescan, isTrustedSender, async ({ id }) => {
    if (id === undefined) library.rescanAll()
    else void library.rescan(id)
  })

  // ── Assets ───────────────────────────────────────────────────────────────
  handle(IpcChannel.queryAssets, isTrustedSender, async (query) => repo.query(query))
  handle(IpcChannel.getAsset, isTrustedSender, async ({ id }) => repo.getAsset(id))
  handle(IpcChannel.setFavorite, isTrustedSender, async ({ id, favorite }) => {
    repo.setFavorite(id, favorite)
    library.organizingChanged()
  })
  handle(IpcChannel.addTag, isTrustedSender, async ({ id, name }) => {
    repo.addTag(id, name)
    library.organizingChanged()
  })
  handle(IpcChannel.removeTag, isTrustedSender, async ({ id, name }) => {
    repo.removeTag(id, name)
    library.organizingChanged()
  })
  handle(IpcChannel.listTags, isTrustedSender, async () => repo.listTags())
  handle(IpcChannel.getCounts, isTrustedSender, async () => repo.counts())

  handle(IpcChannel.revealAsset, isTrustedSender, async ({ id }) => {
    const path = repo.assetPath(id)
    if (!path || !existsSync(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  // ── Drag-out ─────────────────────────────────────────────────────────────
  handle(IpcChannel.pickDragTestFiles, isTrustedSender, async (_request, event) => {
    const result = await openDialog(event, {
      title: 'Choose files to test dragging',
      buttonLabel: 'Use files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((path) => ({
      id: dragRegistry.register(path),
      name: basename(path)
    }))
  })

  listen(IpcChannel.startDrag, isTrustedSender, ({ ids }, event) => {
    // Asset IDs resolve through the library (always inside a root); test IDs through the registry.
    const files = ids
      .map((id) => repo.assetPath(id) ?? dragRegistry.resolve([id])[0] ?? null)
      .filter((path): path is string => path !== null && existsSync(path))
    const [first] = files
    if (!first) return
    event.sender.startDrag({ file: first, files, icon: dragIcon })
  })
}

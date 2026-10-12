import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { basename } from 'path'
import dragIconPath from '../../../resources/drag-icon.png?asset'
import { IpcChannel } from '@shared/channels'
import { handle, listen, type SenderCheck } from './handle'
import { DragRegistry } from '../drag/registry'
import type { WorkerClient } from '../worker/client'
import type { MediaBinaries } from '../media/binaries'
import { databaseCapabilities, type LibraryDatabase } from '../library/database'

export interface IpcDependencies {
  db: LibraryDatabase
  worker: WorkerClient
  binaries: MediaBinaries
}

export function registerIpcHandlers(
  isTrustedSender: SenderCheck,
  { db, worker, binaries }: IpcDependencies
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

  handle(IpcChannel.pickFolder, isTrustedSender, async (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Add a library folder',
      buttonLabel: 'Add folder',
      properties: ['openDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    return result.canceled || !path ? null : { path }
  })

  handle(IpcChannel.pickDragTestFiles, isTrustedSender, async (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Choose files to test dragging',
      buttonLabel: 'Use files',
      properties: ['openFile', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return result.filePaths.map((path) => ({
      id: dragRegistry.register(path),
      name: basename(path)
    }))
  })

  listen(IpcChannel.startDrag, isTrustedSender, ({ ids }, event) => {
    const files = dragRegistry.resolve(ids).filter((path) => existsSync(path))
    const [first] = files
    if (!first) return
    event.sender.startDrag({ file: first, files, icon: dragIcon })
  })
}

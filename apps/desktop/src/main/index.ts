import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { applySecurityPolicies, isTrustedSenderUrl } from './security'
import { createMainWindow, RENDERER_INDEX } from './window'
import { registerIpcHandlers } from './ipc'
import { copyFileSync, existsSync } from 'fs'
import { openDatabase } from './library/database'
import { migrate, needsMigration } from './library/migrations'
import { LibraryRepository } from './library/repository'
import { LibraryService } from './library/service'
import { LIBRARY_EVENT_CHANNEL } from '@shared/channels'
import { handleAssetProtocol, registerAssetScheme } from './media/protocol'
import { WorkerClient } from './worker/client'
import { mediaBinaries } from './media/binaries'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFileUrlPrefix = pathToFileURL(RENDERER_INDEX).href

registerAssetScheme()

// One running instance; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.saxenascreation.assetlibrary')
    nativeTheme.themeSource = 'dark'
    applySecurityPolicies()

    // F12 toggles DevTools in development; Cmd/Ctrl+R reload is disabled in production.
    app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

    const dbFile = join(app.getPath('userData'), 'library.db')
    let db: ReturnType<typeof openDatabase>
    try {
      db = openDatabase(dbFile)
      // Keep a copy before changing the schema, so a failed upgrade can be recovered by hand.
      if (needsMigration(db) && existsSync(dbFile)) {
        db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(dbFile, `${dbFile}.bak`)
      }
      migrate(db)
    } catch (error) {
      // Without this the app would sit in the Dock with no window and no explanation.
      dialog.showErrorBox(
        "Asset Library couldn't open your library",
        `${(error as Error).message}\n\nYour files are untouched. The library is stored in:\n${dbFile}`
      )
      app.exit(1)
      return
    }
    const repo = new LibraryRepository(db)
    const worker = new WorkerClient()
    const binaries = mediaBinaries({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch
    })
    const mediaDir = join(app.getPath('userData'), 'media')
    const catalogDir = join(app.getPath('userData'), 'catalog')
    handleAssetProtocol(repo, mediaDir)
    const library = new LibraryService(
      repo,
      worker,
      binaries,
      { mediaDir, catalogDir, appVersion: app.getVersion() },
      (event) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(LIBRARY_EVENT_CHANNEL, event)
        }
      }
    )
    app.on('will-quit', () => {
      // Order matters: stop scheduling work, stop the worker, then close the database.
      library.stop()
      worker.stop()
      db.close()
    })

    registerIpcHandlers(
      (event) => isTrustedSenderUrl(event.senderFrame?.url, devServerUrl, rendererFileUrlPrefix),
      { db, repo, library, worker, binaries }
    )
    createMainWindow(devServerUrl)
    library.start()
    // Automated tests point the app at a fixture folder (there's no way to drive the OS folder picker).
    const testRoot = process.env['ASSET_LIBRARY_TEST_ROOT']
    if (testRoot && repo.listRoots().length === 0) void library.addRoot(testRoot)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(devServerUrl)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

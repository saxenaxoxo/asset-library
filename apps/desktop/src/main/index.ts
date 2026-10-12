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
import { PanelRequests } from './library/panel-requests'
import { LIBRARY_EVENT_CHANNEL } from '@shared/channels'
import { handleAssetProtocol, registerAssetScheme } from './media/protocol'
import { WorkerClient } from './worker/client'
import { mediaBinaries } from './media/binaries'
import { applyAppMenu } from './menu'
import { RequestHandler } from './engine/request-handler'
import { EngineStatusWriter, statusLine } from './engine/status'
import { SettingsStore } from './engine/settings'
import { electronLoginItem, openedAtLogin } from './engine/login-item'
import { EngineTray } from './engine/tray'
import {
  BACKGROUND_FLAG,
  ENGINE_SCHEME,
  engineUrlAction,
  engineUrlInArgv,
  startsInBackground
} from './engine/launch'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFileUrlPrefix = pathToFileURL(RENDERER_INDEX).href

registerAssetScheme()

/** Shows the library window (creating it if it was closed) and, on macOS, the Dock icon. */
function showWindow(): void {
  const [window] = BrowserWindow.getAllWindows()
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } else {
    createMainWindow(devServerUrl)
  }
  void app.dock?.show()
}

/** assetlibrary://start only makes sure the engine runs (it does now); …://open shows the window. */
function handleEngineUrl(url: string): void {
  if (engineUrlAction(url) === 'open') showWindow()
}

// One running instance. The app runs as a background engine for the Premiere panel; a second
// launch shows the window, unless it's the panel starting the engine or a login start.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // macOS delivers assetlibrary:// URLs as an event, possibly before the app is ready.
  let ready = false
  let launchUrl: string | null = null
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (ready) handleEngineUrl(url)
    else launchUrl = url
  })

  app.on('second-instance', (_event, argv) => {
    if (!ready) return
    const url = engineUrlInArgv(argv)
    if (url) handleEngineUrl(url)
    else if (!argv.includes(BACKGROUND_FLAG)) showWindow()
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.saxenascreation.assetlibrary')
    nativeTheme.themeSource = 'dark'
    applySecurityPolicies()
    applyAppMenu(process.platform, app.getName())

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
    const productName = app.getName()
    const importsFolder = join(app.getPath('videos'), `${productName} Imports`)
    const settings = new SettingsStore(
      join(app.getPath('userData'), 'settings.json'),
      electronLoginItem()
    )
    settings.init()
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
    // Tells the Premiere panel the engine is alive, what it's doing, and how requests went.
    const status = new EngineStatusWriter(catalogDir, {
      version: app.getVersion(),
      importsFolder,
      mediaDir,
      indexing: () => library.indexing(),
      pendingMedia: () => repo.pendingMediaCount(),
      startAtLogin: () => settings.settings.startAtLogin,
      catalogUpdatedAt: () => library.catalogUpdatedAt()
    })
    const setStartAtLogin = (enabled: boolean): void => {
      settings.setStartAtLogin(enabled)
      void status.write()
    }
    const handler = new RequestHandler(library, repo, {
      productName,
      importsFolder,
      setStartAtLogin
    })
    // The Premiere panel asks for things (add a folder, import files…) through files.
    const panelRequests = new PanelRequests(catalogDir, {
      handle: (id, request) => handler.handle(id, request),
      unreadable: (id) => handler.unreadable(id),
      report: (result) => {
        status.invalidateCacheSize()
        status.record(result)
      }
    })
    const tray = new EngineTray(productName, {
      openWindow: showWindow,
      setStartAtLogin,
      quit: () => app.quit()
    })
    tray.update('Starting…', settings.settings.startAtLogin)
    status.onStatus((current) => tray.update(statusLine(current), current.settings.startAtLogin))

    app.on('will-quit', () => {
      // Order matters: stop scheduling work, stop the worker, then close the database.
      panelRequests.stop()
      status.stop()
      tray.destroy()
      library.stop()
      worker.stop()
      db.close()
    })

    registerIpcHandlers(
      (event) => isTrustedSenderUrl(event.senderFrame?.url, devServerUrl, rendererFileUrlPrefix),
      { db, repo, library, worker, binaries }
    )
    // Installed builds claim assetlibrary:// (macOS also learns it from Info.plist). In
    // development the bare Electron binary would be registered instead, so it's skipped.
    if (app.isPackaged) app.setAsDefaultProtocolClient(ENGINE_SCHEME)

    const background = startsInBackground({
      argv: process.argv,
      openedAtLogin: openedAtLogin(),
      url: launchUrl
    })
    if (background) app.dock?.hide()
    else createMainWindow(devServerUrl)
    ready = true
    if (launchUrl && !background) handleEngineUrl(launchUrl)
    library.start()
    panelRequests.start()
    status.start()
    // Automated tests point the app at a fixture folder (there's no way to drive the OS folder picker).
    const testRoot = process.env['ASSET_LIBRARY_TEST_ROOT']
    if (testRoot && repo.listRoots().length === 0) void library.addRoot(testRoot)

    // Clicking the Dock icon, or opening the app again from Finder, brings the window back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showWindow()
    })
  })

  // Closing the window leaves the engine running for the panel (quit from the tray or Cmd+Q).
  // On macOS the Dock icon goes away with the last window.
  app.on('window-all-closed', () => {
    app.dock?.hide()
  })
}

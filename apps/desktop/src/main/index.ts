import { app, dialog, nativeTheme, net, shell } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { applySecurityPolicies, isTrustedSenderUrl } from './security'
import { createMainWindow, mainWindow, RENDERER_INDEX } from './window'
import { registerIpcHandlers } from './ipc'
import { copyFileSync, existsSync, readdirSync } from 'fs'
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
import { AudioPlayer } from './engine/audio-player'
import { PanelInstaller, type UpiaRun } from './engine/panel-installer'
import { UpdateChecker } from './engine/update-check'
import { isAllowedExternalUrl } from './security-rules'
import { CatalogPublisher, readCatalogSnapshot } from './catalog/writer'
import { workerCatalogPublishing } from './catalog/publishing'
import { AUDIO_PAGE } from '@shared/audio-preview'
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

/** Opens the library window. The Dock icon goes away with it (the engine keeps running). */
function openMainWindow(): void {
  createMainWindow(devServerUrl).on('closed', () => {
    if (!mainWindow()) app.dock?.hide()
  })
}

/** Shows the library window (creating it if it was closed) and, on macOS, the Dock icon. */
function showWindow(): void {
  const window = mainWindow()
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } else {
    openMainWindow()
  }
  void app.dock?.show()
}

/** Runs a program with an argument array (no shell) and collects its output. Never rejects. */
function runProgram(file: string, args: string[]): Promise<UpiaRun> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout ?? ''}\n${stderr ?? ''}` })
    )
  })
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
    const appVersion = app.getVersion()
    // The catalog is built and written in the utility process (it's big for big libraries).
    const localCatalog = new CatalogPublisher({ catalogDir, appVersion })
    const publishCatalog = workerCatalogPublishing({
      worker,
      request: { dbFile, catalogDir, mediaDir, appVersion },
      local: (full) => localCatalog.publish(() => readCatalogSnapshot(repo, mediaDir), full)
    })
    // Assigned below; a catalog write tells the panel through engine.json right away.
    let status: EngineStatusWriter | null = null
    const library = new LibraryService(
      repo,
      worker,
      binaries,
      { mediaDir, catalogDir, appVersion },
      (event) => mainWindow()?.webContents.send(LIBRARY_EVENT_CHANNEL, event),
      { publishCatalog, onCatalog: () => void status?.write() }
    )
    const updates = new UpdateChecker({
      appVersion,
      fetch: (url, init) => net.fetch(url, init),
      enabled: () => settings.checkForUpdates,
      state: () => settings.updateCheck,
      record: (at, latest) => settings.recordUpdateCheck(at, latest),
      onChange: () => void status?.write()
    })
    const panelInstaller = new PanelInstaller({
      platform: process.platform,
      env: process.env,
      resourcesDir: app.isPackaged ? process.resourcesPath : null,
      panelName: productName,
      run: runProgram,
      exists: existsSync,
      listFiles: (dir) => readdirSync(dir)
    })
    const audio = new AudioPlayer(
      devServerUrl
        ? new URL(AUDIO_PAGE, devServerUrl).href
        : pathToFileURL(join(__dirname, '../renderer', AUDIO_PAGE)).href
    )
    // Tells the Premiere panel the engine is alive, what it's doing, and how requests went.
    const engineStatus = new EngineStatusWriter(catalogDir, {
      version: appVersion,
      importsFolder,
      mediaDir,
      indexing: () => library.indexing(),
      pendingMedia: () => repo.pendingMediaCount(),
      startAtLogin: () => settings.settings.startAtLogin,
      catalogUpdatedAt: () => library.catalogUpdatedAt(),
      catalog: () => library.catalogVersion(),
      checkForUpdates: () => settings.checkForUpdates,
      update: () => updates.available()
    })
    status = engineStatus
    const setStartAtLogin = (enabled: boolean): void => {
      settings.setStartAtLogin(enabled)
      void engineStatus.write()
    }
    const setCheckForUpdates = (enabled: boolean): void => {
      settings.setCheckForUpdates(enabled)
      if (enabled) void updates.checkIfDue()
      void engineStatus.write()
    }
    const handler = new RequestHandler(library, repo, {
      productName,
      importsFolder,
      setStartAtLogin,
      setCheckForUpdates,
      audio
    })
    // The Premiere panel asks for things (add a folder, import files…) through files.
    const panelRequests = new PanelRequests(catalogDir, {
      handle: (id, request) => handler.handle(id, request),
      unreadable: (id) => handler.unreadable(id),
      report: (result) => {
        engineStatus.invalidateCacheSize()
        engineStatus.record(result)
      }
    })

    let trayLine = 'Starting…'
    let installingPanel = false
    const refreshTray = (): void =>
      tray.update({
        line: trayLine,
        startAtLogin: settings.settings.startAtLogin,
        update: updates.available(),
        canInstallPanel: !installingPanel
      })
    const installPanel = async (): Promise<void> => {
      installingPanel = true
      refreshTray()
      const result = await panelInstaller.install()
      installingPanel = false
      refreshTray()
      // In the background the engine has no window; bring the answer to the front.
      app.focus({ steal: true })
      void dialog.showMessageBox({
        type: result.ok ? 'info' : 'warning',
        message: result.ok ? 'Premiere Pro panel installed' : "The panel wasn't installed",
        detail: result.message
      })
    }
    const tray = new EngineTray(productName, {
      openWindow: showWindow,
      setStartAtLogin,
      installPanel: () => void installPanel(),
      openUpdate: (url) => {
        if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      },
      quit: () => app.quit()
    })
    refreshTray()
    engineStatus.onStatus((current) => {
      trayLine = statusLine(current)
      refreshTray()
    })

    // Quitting removes engine.json, so the panel shows "not running" at once. The status write
    // in progress (if any) is awaited first, or it would put the file back.
    let quitting = false
    app.on('before-quit', (event) => {
      if (quitting) return
      quitting = true
      event.preventDefault()
      panelRequests.stop()
      audio.destroy()
      updates.stop()
      void engineStatus.shutdown().finally(() => app.quit())
    })
    app.on('will-quit', () => {
      // Order matters: stop scheduling work, stop the worker, then close the database.
      panelRequests.stop()
      engineStatus.stop()
      engineStatus.removeFile()
      audio.destroy()
      updates.stop()
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
    else openMainWindow()
    ready = true
    if (launchUrl && !background) handleEngineUrl(launchUrl)
    library.start()
    panelRequests.start()
    engineStatus.start()
    // Installed builds only: development and test runs never reach the network or Premiere.
    if (app.isPackaged && !process.env['ASSET_LIBRARY_NO_UPDATE_CHECK']) updates.start()
    if (app.isPackaged && !process.env['ASSET_LIBRARY_NO_PANEL_INSTALL']) {
      // First launch of a new build: put its panel into Premiere Pro, replacing older copies.
      void panelInstaller
        .installIfNeeded(settings.panelAutoInstalled, (version) =>
          settings.recordPanelAutoInstall(version)
        )
        .catch(() => undefined)
    }
    // Automated tests point the app at a fixture folder (there's no way to drive the OS folder picker).
    const testRoot = process.env['ASSET_LIBRARY_TEST_ROOT']
    if (testRoot && repo.listRoots().length === 0) void library.addRoot(testRoot)

    // Clicking the Dock icon, or opening the app again from Finder, brings the window back.
    app.on('activate', () => {
      if (!mainWindow()) showWindow()
    })
  })

  // Closing the window leaves the engine running for the panel (quit from the tray or Cmd+Q).
  // On macOS the Dock icon goes away with the last window.
  app.on('window-all-closed', () => {
    app.dock?.hide()
  })
}

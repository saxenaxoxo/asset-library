import { app, dialog, nativeTheme, net, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { homedir } from 'os'
import { brandIdentity } from '@brand/brand-identity'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { applySecurityPolicies, isTrustedSenderUrl } from './security'
import { createMainWindow, mainWindow, RENDERER_INDEX } from './window'
import { registerIpcHandlers } from './ipc'
import { registerInstallerHandlers } from './ipc/installer'
import { installerStatus } from './engine/installer-status'
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'fs'
import { openDatabase } from './library/database'
import { migrate, needsMigration } from './library/migrations'
import { LibraryRepository } from './library/repository'
import { LibraryService } from './library/service'
import { PanelRequests } from './library/panel-requests'
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
import { PanelDelivery } from './engine/panel-delivery'
import { ASSET_LIBRARY_PRODUCT_ID } from './engine/panel-manifest'
import { electronHttpGet } from './engine/electron-http'
import { UpdateChecker } from './engine/update-check'
import { cepExtensionFolder, macAppBundle, Uninstaller } from './engine/uninstaller'
import { prepareDataFolder } from './engine/data-folder'
import { legacyMacApps } from './engine/legacy-install'
import { installedCopyToHandOver, isInstalledCopy, type CopyFacts } from './engine/installed-copy'
import {
  isAllowedDownloadRedirect,
  isAllowedDownloadUrl,
  isAllowedExternalUrl,
  loopbackTestOrigin,
  PANEL_MANIFEST_URL
} from './security-rules'
import { CatalogPublisher, readCatalogSnapshot } from './catalog/writer'
import { workerCatalogPublishing } from './catalog/publishing'
import { AUDIO_PAGE } from '@shared/audio-preview'
import { engineCopy } from '@shared/engine-copy'
import {
  BACKGROUND_FLAG,
  ENGINE_SCHEME,
  engineUrlAction,
  engineUrlInArgv,
  startsInBackground
} from './engine/launch'

/** Unchanged by the rename to Goated Panels Hub: Windows and macOS know the app by it. */
const APP_ID = 'com.saxenascreation.assetlibrary'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFileUrlPrefix = pathToFileURL(RENDERER_INDEX).href

registerAssetScheme()

/** Set once quitting has begun, so closing windows on the way out isn't "closed by the editor". */
let quitting = false
/** Called when the editor closes the window and the engine keeps running. Set once ready. */
let onWindowClosedByEditor: () => void = () => {}

/** Opens the installer window. The Dock icon goes away with it (the engine keeps running). */
function openMainWindow(): void {
  createMainWindow(devServerUrl).on('closed', () => {
    if (!mainWindow()) app.dock?.hide()
    if (!quitting) onWindowClosedByEditor()
  })
}

/**
 * Quitting stops the engine the Premiere panel relies on, so the menu-bar Quit and Cmd+Q ask
 * first. (Logging out or shutting down doesn't come through here and isn't held up.)
 */
async function confirmQuit(): Promise<void> {
  app.focus({ steal: true })
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    message: engineCopy.quitMessage,
    detail: engineCopy.quitDetail,
    buttons: [engineCopy.quitConfirm, engineCopy.quitCancel],
    defaultId: 1,
    cancelId: 1
  }
  // Over the window when it's open (a sheet on macOS), else on its own.
  const window = mainWindow()
  const { response } = await (window
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options))
  if (response === 0) app.quit()
}

/** Shows the installer window (creating it if it was closed) and, on macOS, the Dock icon. */
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
function runProgram(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<UpiaRun> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024, env },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout ?? ''}\n${stderr ?? ''}` })
    )
  })
}

/** assetlibrary://start only makes sure the engine runs (it does now); …://open shows the window. */
function handleEngineUrl(url: string): void {
  if (engineUrlAction(url) === 'open') showWindow()
}

// The data folder was "Asset Library" before the rename; move it before anything opens it.
const dataFolder = prepareDataFolder()

// Only the installed copy claims assetlibrary://, the login item and Premiere's panel; a build
// elsewhere (dist folder, disk image) started by the panel hands over to the installed one.
const copyFacts: CopyFacts = {
  platform: process.platform,
  packaged: app.isPackaged,
  execPath: process.execPath,
  home: homedir(),
  productName: app.getName(),
  exists: existsSync
}
const installedCopy = isInstalledCopy(copyFacts)

// One running instance. The app runs as a background engine for the Premiere panel; a second
// launch shows the window, unless it's the panel starting the engine or a login start.
if (dataFolder.quit || !app.requestSingleInstanceLock()) {
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
    // Test runs launch dist builds on purpose (they set ASSET_LIBRARY_NO_LOGIN_ITEM).
    const handOver = process.env['ASSET_LIBRARY_NO_LOGIN_ITEM']
      ? null
      : installedCopyToHandOver(copyFacts)
    if (
      handOver &&
      startsInBackground({ argv: process.argv, openedAtLogin: openedAtLogin(), url: launchUrl })
    ) {
      console.info(`Not the installed copy; starting ${handOver} instead.`)
      app.releaseSingleInstanceLock()
      const args = launchUrl ? [launchUrl] : ['--args', BACKGROUND_FLAG]
      spawn('/usr/bin/open', ['-a', handOver, ...args], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
      return
    }
    electronApp.setAppUserModelId(APP_ID)
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
        `${brandIdentity.hubName} couldn't open your library`,
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
    // Named after the product, not the app, so imports keep going to the folder they always did.
    const importsFolder = join(app.getPath('videos'), `${brandIdentity.primaryProductName} Imports`)
    const settings = new SettingsStore(
      join(app.getPath('userData'), 'settings.json'),
      electronLoginItem(installedCopy)
    )
    settings.init({
      reapplyLoginItem: dataFolder.moved,
      trustLoginItem: !dataFolder.moveUnfinished
    })
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
      // No window listens to scan events any more: the panel reads the catalog.
      () => {},
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
    // Automated tests replace Adobe's installer with a Node script (never the real one).
    const testUpia = process.env['ASSET_LIBRARY_TEST_UPIA'] || null
    const panelInstaller = new PanelInstaller({
      platform: process.platform,
      env: process.env,
      resourcesDir: app.isPackaged ? process.resourcesPath : null,
      // The panel is the product: Adobe's installer knows it as Asset Library, whatever the app's name.
      panelName: brandIdentity.primaryProductName,
      run: testUpia
        ? (file, args) =>
            runProgram(process.execPath, [file, ...args], {
              ...process.env,
              ELECTRON_RUN_AS_NODE: '1'
            })
        : (file, args) => runProgram(file, args),
      exists: existsSync,
      listFiles: (dir) => readdirSync(dir),
      agentPath: testUpia
    })
    // Newer panels are downloaded (and verified) from the manifest when the Hub window asks;
    // the copy built into the app is the offline fallback. Tests serve the manifest locally.
    const testManifestUrl = process.env['ASSET_LIBRARY_TEST_MANIFEST_URL']
    const testOrigin = loopbackTestOrigin(testManifestUrl)
    const panelDelivery = new PanelDelivery({
      productId: ASSET_LIBRARY_PRODUCT_ID,
      manifestUrl: testOrigin && testManifestUrl ? testManifestUrl : PANEL_MANIFEST_URL,
      http: electronHttpGet,
      isAllowedUrl: (url) => isAllowedDownloadUrl(url, testOrigin),
      isAllowedRedirect: (url) => isAllowedDownloadRedirect(url, testOrigin),
      downloadsDir: join(app.getPath('userData'), 'downloads'),
      installer: panelInstaller
    })
    void panelDelivery.cleanUp().catch(() => undefined)
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
      audio,
      ...(app.isPackaged ? { uninstall: () => void uninstaller.run() } : {})
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
      const result = await panelDelivery.install()
      installingPanel = false
      refreshTray()
      // In the background the engine has no window; bring the answer to the front.
      app.focus({ steal: true })
      void dialog.showMessageBox({
        type: result.ok ? 'info' : 'warning',
        message: result.ok ? 'Premiere Pro panel installed' : "The panel wasn't installed",
        detail: result.ok ? `${result.message}\n\n${engineCopy.afterInstall}` : result.message
      })
    }
    const tray = new EngineTray(productName, {
      openWindow: showWindow,
      setStartAtLogin: (enabled) => {
        setStartAtLogin(enabled)
        refreshTray()
      },
      installPanel: () => void installPanel(),
      openUpdate: (url) => {
        if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      },
      uninstall: () => void uninstaller.run(),
      quit: () => void confirmQuit()
    })
    refreshTray()

    // Uninstall: from the panel's Settings, the tray menu or the macOS app menu.
    const uninstaller = new Uninstaller({
      platform: process.platform,
      productName,
      packaged: app.isPackaged,
      execPath: process.execPath,
      dataDir: app.getPath('userData'),
      legacyDataDir: dataFolder.legacyDir,
      cepFolder: cepExtensionFolder(process.platform, homedir(), app.getPath('appData')),
      confirm: async () => {
        // In the background the engine has no window; bring the question to the front.
        app.focus({ steal: true })
        const windows = process.platform === 'win32'
        const { response, checkboxChecked } = await dialog.showMessageBox({
          type: 'warning',
          message: `Uninstall ${productName}?`,
          detail: [
            `This removes the ${brandIdentity.primaryProductName} panel from Premiere Pro, stops ${productName} from starting at login, and ${windows ? 'runs its uninstaller' : `moves ${productName} to the Trash`}. The panel stops working without it.`,
            'Your own asset files are never touched.'
          ].join('\n\n'),
          checkboxLabel: 'Also delete my library: folder list, tags, favorites and thumbnails',
          checkboxChecked: false,
          buttons: ['Uninstall', 'Cancel'],
          defaultId: 1,
          cancelId: 1
        })
        return { confirmed: response === 0, deleteData: checkboxChecked }
      },
      removePanels: () => panelInstaller.removeAll(),
      forgetSystemEntries: () => {
        electronLoginItem(app.isPackaged).set(false)
        if (app.isPackaged) app.removeAsDefaultProtocolClient(ENGINE_SCHEME)
      },
      stopEngine: async () => {
        panelRequests.stop()
        audio.destroy()
        updates.stop()
        await engineStatus.shutdown()
        tray.destroy()
        library.stop()
        worker.stop()
        db.close()
      },
      exists: existsSync,
      trash: (path) => shell.trashItem(path),
      launch: (file, args) => spawn(file, args, { detached: true, stdio: 'ignore' }).unref(),
      tell: async (kind, message, detail) => {
        app.focus({ steal: true })
        await dialog.showMessageBox({ type: kind, message, detail })
      },
      exit: () => app.exit(0)
    })
    applyAppMenu(process.platform, productName, {
      uninstall: () => void uninstaller.run(),
      quit: () => void confirmQuit()
    })
    // The first time the editor closes the window, say that the engine is still on, and where.
    onWindowClosedByEditor = () => {
      if (settings.backgroundNoteShown) return
      settings.recordBackgroundNoteShown()
      void dialog.showMessageBox({
        type: 'info',
        message: engineCopy.closedMessage,
        detail: engineCopy.closedDetail(process.platform),
        buttons: ['OK']
      })
    }
    engineStatus.onStatus((current) => {
      trayLine = statusLine(current)
      refreshTray()
    })

    // Quitting removes engine.json, so the panel shows "not running" at once. The status write
    // in progress (if any) is awaited first, or it would put the file back.
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

    const trustedSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean =>
      isTrustedSenderUrl(event.senderFrame?.url, devServerUrl, rendererFileUrlPrefix)
    registerIpcHandlers(trustedSender, { db, worker, binaries })
    registerInstallerHandlers(trustedSender, {
      status: (refresh) =>
        installerStatus({
          platform: process.platform,
          env: process.env,
          home: homedir(),
          appVersion,
          packaged: app.isPackaged,
          dataDir: app.getPath('userData'),
          cacheDir: mediaDir,
          inventory: () => panelInstaller.inventory(),
          bundled: () => panelInstaller.bundled(),
          catalog: () => panelDelivery.catalog(refresh),
          sources: (catalog, premiere) => panelDelivery.sources(catalog, premiere),
          otherProducts: (catalog) => panelDelivery.otherProducts(catalog),
          exists: existsSync,
          listDir: (dir) => readdirSync(dir)
        }),
      install: async (builds) => {
        installingPanel = true
        refreshTray()
        try {
          return await panelDelivery.install(builds)
        } finally {
          installingPanel = false
          refreshTray()
        }
      },
      progress: () => panelDelivery.progress(),
      cancel: () => panelDelivery.cancel(),
      remove: (builds) => panelInstaller.removeAll(builds),
      uninstall: () => void uninstaller.run(),
      engine: () => ({
        running: true,
        line: trayLine,
        startAtLogin: settings.settings.startAtLogin
      }),
      setStartAtLogin: (enabled) => {
        setStartAtLogin(enabled)
        refreshTray()
      }
    })
    // The installed copy claims assetlibrary:// (macOS also learns it from Info.plist). In
    // development the bare Electron binary would be registered instead, and a stray build would
    // take the panel's start link over, so both are skipped.
    if (installedCopy) app.setAsDefaultProtocolClient(ENGINE_SCHEME)
    // The app as installed before the rename has the same bundle ID, so macOS could open it for
    // assetlibrary:// links or at login. Its data has moved here; the old app goes to the Trash.
    if (app.isPackaged && process.platform === 'darwin' && dataFolder.realInstall) {
      const old = legacyMacApps(
        homedir(),
        APP_ID,
        macAppBundle(process.execPath),
        (bundle) => {
          try {
            return readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8')
          } catch {
            return null
          }
        },
        (path) => {
          try {
            return realpathSync(path)
          } catch {
            return null
          }
        }
      )
      for (const bundle of old) {
        shell.trashItem(bundle).then(
          () => console.info(`Moved ${bundle} (the app before its rename) to the Trash.`),
          (error: Error) => console.error(`Couldn't move ${bundle} to the Trash: ${error.message}`)
        )
      }
    }

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
    if (installedCopy && !process.env['ASSET_LIBRARY_NO_PANEL_INSTALL']) {
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

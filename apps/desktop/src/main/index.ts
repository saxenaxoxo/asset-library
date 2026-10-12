import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { applySecurityPolicies, isTrustedSenderUrl } from './security'
import { createMainWindow, RENDERER_INDEX } from './window'
import { registerIpcHandlers } from './ipc'
import { openDatabase } from './library/database'
import { WorkerClient } from './worker/client'
import { mediaBinaries } from './media/binaries'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFileUrlPrefix = pathToFileURL(RENDERER_INDEX).href

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

    const db = openDatabase(join(app.getPath('userData'), 'library.db'))
    const worker = new WorkerClient()
    const binaries = mediaBinaries({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch
    })
    app.on('will-quit', () => {
      worker.stop()
      db.close()
    })

    registerIpcHandlers(
      (event) => isTrustedSenderUrl(event.senderFrame?.url, devServerUrl, rendererFileUrlPrefix),
      { db, worker, binaries }
    )
    createMainWindow(devServerUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(devServerUrl)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

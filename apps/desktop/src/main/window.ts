import { BrowserWindow } from 'electron'
import { join } from 'path'
import { brandIdentity } from '@brand/brand-identity'

export const RENDERER_INDEX = join(__dirname, '../renderer/index.html')
const WINDOW_BACKGROUND = '#101014'

let current: BrowserWindow | null = null

/** The installer window, if it's open. The engine has other (hidden) windows, so don't guess. */
export function mainWindow(): BrowserWindow | null {
  return current && !current.isDestroyed() ? current : null
}

export function createMainWindow(devServerUrl: string | undefined): BrowserWindow {
  const window = new BrowserWindow({
    title: brandIdentity.hubName,
    width: 940,
    height: 680,
    minWidth: 720,
    minHeight: 540,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  current = window
  window.on('closed', () => {
    if (current === window) current = null
  })
  window.once('ready-to-show', () => window.show())

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(RENDERER_INDEX)
  }
  return window
}

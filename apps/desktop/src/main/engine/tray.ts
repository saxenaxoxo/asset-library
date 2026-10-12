import { readFileSync } from 'fs'
import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import macIcon from '../../../resources/trayTemplate.png?asset'
import macIcon2x from '../../../resources/trayTemplate@2x.png?asset'
import winIcon from '../../../resources/tray.png?asset'
import winIcon2x from '../../../resources/tray@2x.png?asset'

export interface TrayActions {
  openWindow(): void
  setStartAtLogin(enabled: boolean): void
  quit(): void
}

/** The menu-bar (macOS) or notification-area (Windows) icon, at 1x and 2x. */
function trayImage(platform: NodeJS.Platform): NativeImage {
  const [one, two] = platform === 'darwin' ? [macIcon, macIcon2x] : [winIcon, winIcon2x]
  const image = nativeImage.createFromPath(one)
  try {
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(two) })
  } catch {
    // The 1x image alone still works, just softer on high-DPI screens.
  }
  // A template image is drawn by macOS in the menu bar's colour (dark or light).
  if (platform === 'darwin') image.setTemplateImage(true)
  return image
}

/**
 * The engine's only always-visible piece: shows what it's doing and lets the editor open the
 * window, choose whether it starts at login, or quit.
 */
export class EngineTray {
  private readonly tray: Tray
  private line = ''
  private startAtLogin = false

  constructor(
    private readonly productName: string,
    private readonly actions: TrayActions,
    platform: NodeJS.Platform = process.platform
  ) {
    this.tray = new Tray(trayImage(platform))
    this.tray.setToolTip(productName)
    // On Windows a click on the icon is the usual way to bring an app back.
    if (platform !== 'darwin') this.tray.on('click', () => actions.openWindow())
  }

  /** Rebuilds the menu only when what it shows has changed. */
  update(line: string, startAtLogin: boolean): void {
    if (line === this.line && startAtLogin === this.startAtLogin && this.line !== '') return
    this.line = line
    this.startAtLogin = startAtLogin
    this.tray.setToolTip(`${this.productName}: ${line}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: line, enabled: false },
        { type: 'separator' },
        { label: `Open ${this.productName} window`, click: () => this.actions.openWindow() },
        {
          label: 'Start at login',
          type: 'checkbox',
          checked: startAtLogin,
          click: (item) => this.actions.setStartAtLogin(item.checked)
        },
        { type: 'separator' },
        { label: `Quit ${this.productName}`, click: () => this.actions.quit() }
      ])
    )
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}

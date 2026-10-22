import { readFileSync } from 'fs'
import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { brandIdentity } from '@brand/brand-identity'
import { engineCopy } from '@shared/engine-copy'
import macIcon from '../../../resources/trayTemplate.png?asset'
import macIcon2x from '../../../resources/trayTemplate@2x.png?asset'
import winIcon from '../../../resources/tray.png?asset'
import winIcon2x from '../../../resources/tray@2x.png?asset'

export interface TrayActions {
  openWindow(): void
  setStartAtLogin(enabled: boolean): void
  /** Installs (or reinstalls) the bundled Premiere Pro panel. */
  installPanel(): void
  /** Opens the newer release's page in the browser. */
  openUpdate(url: string): void
  /** Asks to confirm, then removes the app, its panel and (if chosen) its data. */
  uninstall(): void
  /** Asks to confirm (the panel needs the engine), then quits. */
  quit(): void
}

/** What the tray menu shows. */
export interface TrayState {
  line: string
  startAtLogin: boolean
  update: { version: string; url: string } | null
  /** False while the panel is being installed (the item is greyed out). */
  canInstallPanel: boolean
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
  private shown = ''

  constructor(
    private readonly productName: string,
    private readonly actions: TrayActions,
    platform: NodeJS.Platform = process.platform
  ) {
    this.tray = new Tray(trayImage(platform))
    this.tray.setToolTip(engineCopy.trayRunning)
    // On Windows a click on the icon is the usual way to bring an app back.
    if (platform !== 'darwin') this.tray.on('click', () => actions.openWindow())
  }

  /** Rebuilds the menu only when what it shows has changed. */
  update(state: TrayState): void {
    const key = JSON.stringify(state)
    if (key === this.shown) return
    this.shown = key
    const { line, startAtLogin, update } = state
    this.tray.setToolTip(engineCopy.trayTooltip(line))
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        // Says first that this is the engine and that it's on; then what it's doing.
        { label: engineCopy.trayRunning, enabled: false },
        { label: line, enabled: false },
        ...(update
          ? [
              {
                label: `Update available (${update.version})…`,
                click: () => this.actions.openUpdate(update.url)
              }
            ]
          : []),
        { type: 'separator' },
        { label: `Open ${brandIdentity.hubName}`, click: () => this.actions.openWindow() },
        {
          label: 'Install Premiere Pro panel',
          enabled: state.canInstallPanel,
          click: () => this.actions.installPanel()
        },
        {
          label: engineCopy.trayStartAtLogin,
          type: 'checkbox',
          checked: startAtLogin,
          click: (item) => this.actions.setStartAtLogin(item.checked)
        },
        { type: 'separator' },
        { label: `Uninstall ${this.productName}…`, click: () => this.actions.uninstall() },
        { label: engineCopy.trayQuit, click: () => this.actions.quit() }
      ])
    )
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}

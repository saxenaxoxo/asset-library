import { Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * The app's menu. Replaces Electron's default one, which links to Electron's website and keeps a
 * developer-tools shortcut in installed builds. macOS needs an Edit menu for copy and paste to work
 * in text fields; Windows has no menu bar (text-field shortcuts work without one).
 */
export function applyAppMenu(platform: NodeJS.Platform, productName: string): void {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: productName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

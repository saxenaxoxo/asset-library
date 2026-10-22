import nodePath from 'path'

// Removes Asset Library from the computer when the editor asks for it (Premiere panel Settings,
// the menu-bar icon, or the macOS app menu): the Premiere Pro panel, the login item and link,
// optionally the library data, and the app itself. Electron-specific pieces are injected so the
// order and the messages can be tested.

/** The CEP extension's folder name (its bundle ID), used by hand-copied installs. */
export const CEP_EXTENSION_ID = 'com.saxenascreation.assetlibrary.cep'

/** The `.app` bundle a macOS executable belongs to, or null outside one. */
export function macAppBundle(execPath: string): string | null {
  const marker = '.app/Contents/MacOS/'
  const at = execPath.indexOf(marker)
  return at === -1 ? null : execPath.slice(0, at + '.app'.length)
}

/** The uninstaller electron-builder's Windows installer puts beside the app. */
export function windowsUninstaller(execPath: string, productName: string): string {
  return nodePath.win32.join(nodePath.win32.dirname(execPath), `Uninstall ${productName}.exe`)
}

/** Where a hand-copied CEP extension lives for this user, or null on other platforms. */
export function cepExtensionFolder(
  platform: NodeJS.Platform,
  home: string,
  appData: string
): string | null {
  if (platform === 'darwin') {
    return nodePath.posix.join(
      home,
      'Library/Application Support/Adobe/CEP/extensions',
      CEP_EXTENSION_ID
    )
  }
  if (platform === 'win32') {
    return nodePath.win32.join(appData, 'Adobe', 'CEP', 'extensions', CEP_EXTENSION_ID)
  }
  return null
}

export interface UninstallChoice {
  confirmed: boolean
  /** Also remove the library: folder list, tags, favorites, thumbnails and previews. */
  deleteData: boolean
}

export interface UninstallerDeps {
  platform: NodeJS.Platform
  productName: string
  /** False in development: there's no installed app to remove. */
  packaged: boolean
  execPath: string
  /** The app's data folder (library database, thumbnails, catalog, settings). */
  dataDir: string
  /** The data folder's name before the rename: a link to `dataDir`, or the old folder. */
  legacyDataDir: string
  cepFolder: string | null
  confirm(): Promise<UninstallChoice>
  removePanels(): Promise<{ ok: boolean; message: string }>
  /** Turns off start at login and gives up the assetlibrary:// link. */
  forgetSystemEntries(): void
  /** Stops indexing, the panel requests and the database, so nothing writes any more. */
  stopEngine(): Promise<void>
  exists(path: string): boolean
  /** Moves to the Trash (macOS) or Recycle Bin. Rejects when it can't. */
  trash(path: string): Promise<void>
  /** Starts a program that outlives the app. */
  launch(file: string, args: string[]): void
  tell(kind: 'info' | 'warning', message: string, detail: string): Promise<void>
  exit(): void
}

export class Uninstaller {
  private running = false

  constructor(private readonly deps: UninstallerDeps) {}

  /** Asks first; does nothing unless the editor confirms. Ends by quitting the app. */
  async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.runNow()
    } finally {
      this.running = false
    }
  }

  private async runNow(): Promise<void> {
    const d = this.deps
    if (!d.packaged) {
      await d.tell(
        'info',
        'Nothing to uninstall',
        `This is a development copy of ${d.productName}, so nothing was installed on this computer.`
      )
      return
    }
    const choice = await d.confirm()
    if (!choice.confirmed) return

    const problems: string[] = []
    const panels = await d.removePanels()
    if (!panels.ok) problems.push(panels.message)
    if (d.cepFolder && d.exists(d.cepFolder)) {
      await d.trash(d.cepFolder).catch(() => {
        problems.push(`Couldn't remove the panel folder ${d.cepFolder}. Delete it yourself.`)
      })
    }
    d.forgetSystemEntries()
    await d.stopEngine()

    if (d.platform === 'win32') {
      // Windows removes an installed app with its own uninstaller, which also deletes the data
      // when asked to (--delete-app-data).
      const uninstaller = windowsUninstaller(d.execPath, d.productName)
      if (d.exists(uninstaller)) {
        // The editor already answered "delete my library?"; the uninstaller mustn't ask again.
        d.launch(uninstaller, [choice.deleteData ? '--delete-app-data' : '--keep-app-data'])
        // It can't show what went wrong in here, so say it before handing over.
        if (problems.length > 0) {
          await d.tell('warning', `${d.productName} was partly removed`, problems.join('\n\n'))
        }
      } else {
        await d.tell(
          'warning',
          `${d.productName} was partly removed`,
          [
            ...problems,
            `Its uninstaller wasn't found. Remove ${d.productName} in Settings → Apps.`
          ].join('\n\n')
        )
      }
      d.exit()
      return
    }

    if (choice.deleteData) {
      // Looked at first: once the data is gone, the old-name link points nowhere and no longer
      // "exists", yet it's still there.
      const legacyThere = d.exists(d.legacyDataDir)
      await d.trash(d.dataDir).catch(() => {
        problems.push(`Couldn't move your library data to the Trash. It's in ${d.dataDir}.`)
      })
      // Trashing the link moves only the link; the data it pointed at went just above.
      if (legacyThere) await d.trash(d.legacyDataDir).catch(() => undefined)
    }
    const bundle = macAppBundle(d.execPath)
    const appTrashed = bundle
      ? await d.trash(bundle).then(
          () => true,
          () => false
        )
      : false
    if (!appTrashed) {
      problems.push(
        `Couldn't move ${d.productName} to the Trash (it may be running from the disk image). Quit it and drag it to the Trash yourself.`
      )
    }
    const notes = [
      'Restart Premiere Pro to clear the panel from its Window menu.',
      choice.deleteData
        ? ''
        : `Your library data was kept, in case you install ${d.productName} again: ${d.dataDir}`
    ].filter(Boolean)
    await d.tell(
      problems.length > 0 ? 'warning' : 'info',
      problems.length > 0 ? `${d.productName} was partly removed` : `${d.productName} was removed`,
      [...problems, ...notes].join('\n\n')
    )
    d.exit()
  }
}

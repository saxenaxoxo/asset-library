import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** The engine's own settings, kept in `<userData>/settings.json`. */
export interface EngineSettings {
  startAtLogin: boolean
}

/** A newer release found by the update check. */
export interface AvailableUpdate {
  version: string
  url: string
}

interface StoredSettings {
  startAtLogin?: boolean
  /** The daily check for a new release (on unless the user turned it off). */
  checkForUpdates?: boolean
  lastUpdateCheckAt?: number
  /** What the last check found, shown until the app is updated. */
  latestRelease?: AvailableUpdate
  /** The bundled panel version the engine last tried to install by itself. */
  panelAutoInstalled?: string
  /**
   * The choice was made by a copy that may not touch the login item (one not installed yet, e.g.
   * opened from the disk image), so the installed copy still has to apply it.
   */
  loginItemPending?: true
  /** The one-time "still running in the background" note was shown after closing the window. */
  backgroundNoteShown?: true
}

/** Turns the operating system's "open at login" entry on or off. Electron-specific, so injected. */
export interface LoginItem {
  set(enabled: boolean): void
  /** What the OS says right now, or null when it can't tell (development builds). */
  get(): boolean | null
}

/** Reads and writes settings.json. A missing or damaged file means "first run, defaults". */
export class SettingsStore {
  private stored: StoredSettings

  constructor(
    private readonly file: string,
    private readonly loginItem: LoginItem
  ) {
    this.stored = SettingsStore.read(file)
  }

  private static read(file: string): StoredSettings {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (!data || typeof data !== 'object') return {}
      const d = data as Record<string, unknown>
      const stored: StoredSettings = {}
      if (typeof d['startAtLogin'] === 'boolean') stored.startAtLogin = d['startAtLogin']
      if (typeof d['checkForUpdates'] === 'boolean') stored.checkForUpdates = d['checkForUpdates']
      if (typeof d['lastUpdateCheckAt'] === 'number') {
        stored.lastUpdateCheckAt = d['lastUpdateCheckAt']
      }
      const release = d['latestRelease'] as Partial<AvailableUpdate> | undefined
      if (release && typeof release.version === 'string' && typeof release.url === 'string') {
        stored.latestRelease = { version: release.version, url: release.url }
      }
      if (typeof d['panelAutoInstalled'] === 'string') {
        stored.panelAutoInstalled = d['panelAutoInstalled']
      }
      if (d['loginItemPending'] === true) stored.loginItemPending = true
      if (d['backgroundNoteShown'] === true) stored.backgroundNoteShown = true
      return stored
    } catch {
      return {}
    }
  }

  get settings(): EngineSettings {
    return { startAtLogin: this.stored.startAtLogin ?? true }
  }

  get checkForUpdates(): boolean {
    return this.stored.checkForUpdates ?? true
  }

  setCheckForUpdates(enabled: boolean): void {
    this.stored = { ...this.stored, checkForUpdates: enabled }
    this.save()
  }

  /** When the update check last ran, and the newer release it found (if any). */
  get updateCheck(): { lastCheckAt: number | null; latest: AvailableUpdate | null } {
    return {
      lastCheckAt: this.stored.lastUpdateCheckAt ?? null,
      latest: this.stored.latestRelease ?? null
    }
  }

  recordUpdateCheck(at: number, latest: AvailableUpdate | null): void {
    const next: StoredSettings = { ...this.stored, lastUpdateCheckAt: at }
    if (latest) next.latestRelease = latest
    else delete next.latestRelease
    this.stored = next
    this.save()
  }

  get panelAutoInstalled(): string | null {
    return this.stored.panelAutoInstalled ?? null
  }

  recordPanelAutoInstall(version: string): void {
    this.stored = { ...this.stored, panelAutoInstalled: version }
    this.save()
  }

  get backgroundNoteShown(): boolean {
    return this.stored.backgroundNoteShown === true
  }

  recordBackgroundNoteShown(): void {
    this.stored = { ...this.stored, backgroundNoteShown: true }
    this.save()
  }

  /**
   * Call once at start-up. The first time, turns "start at login" on (the default) and records
   * it, so a later "off" from the user sticks. After that, follows what the OS says, in case the
   * user switched it off in System Settings or Task Manager.
   *
   * `reapplyLoginItem`: the app was just renamed (its data folder moved), so the OS entry still
   * names the old app. The remembered choice is written again for the renamed app instead.
   * `trustLoginItem: false`: the OS entry may name the old app (a move didn't finish), so it
   * isn't read as the editor's choice; the remembered one stays.
   */
  init({
    reapplyLoginItem = false,
    trustLoginItem = true
  }: { reapplyLoginItem?: boolean; trustLoginItem?: boolean } = {}): void {
    if (this.stored.startAtLogin === undefined) {
      this.setStartAtLogin(true)
      return
    }
    if (!trustLoginItem && !reapplyLoginItem) return
    const actual = this.loginItem.get()
    if (reapplyLoginItem || (this.stored.loginItemPending && actual !== null)) {
      this.setStartAtLogin(this.stored.startAtLogin)
      return
    }
    if (actual !== null && actual !== this.stored.startAtLogin) {
      this.stored = { ...this.stored, startAtLogin: actual }
      this.save()
    }
  }

  setStartAtLogin(enabled: boolean): void {
    this.loginItem.set(enabled)
    const next: StoredSettings = { ...this.stored, startAtLogin: enabled }
    if (this.loginItem.get() === null) next.loginItemPending = true
    else delete next.loginItemPending
    this.stored = next
    this.save()
  }

  private save(): void {
    const temp = `${this.file}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(temp, JSON.stringify(this.stored, null, 2))
      renameSync(temp, this.file)
    } catch {
      rmSync(temp, { force: true })
      // Not being able to save a preference must never stop the engine.
    }
  }
}

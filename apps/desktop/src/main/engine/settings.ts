import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** The engine's own settings, kept in `<userData>/settings.json`. */
export interface EngineSettings {
  startAtLogin: boolean
}

interface StoredSettings {
  startAtLogin?: boolean
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
      const login = (data as Record<string, unknown>)['startAtLogin']
      return typeof login === 'boolean' ? { startAtLogin: login } : {}
    } catch {
      return {}
    }
  }

  get settings(): EngineSettings {
    return { startAtLogin: this.stored.startAtLogin ?? true }
  }

  /**
   * Call once at start-up. The first time, turns "start at login" on (the default) and records
   * it, so a later "off" from the user sticks. After that, follows what the OS says, in case the
   * user switched it off in System Settings or Task Manager.
   */
  init(): void {
    if (this.stored.startAtLogin === undefined) {
      this.setStartAtLogin(true)
      return
    }
    const actual = this.loginItem.get()
    if (actual !== null && actual !== this.stored.startAtLogin) {
      this.stored = { ...this.stored, startAtLogin: actual }
      this.save()
    }
  }

  setStartAtLogin(enabled: boolean): void {
    this.loginItem.set(enabled)
    this.stored = { ...this.stored, startAtLogin: enabled }
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

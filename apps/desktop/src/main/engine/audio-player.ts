import { BrowserWindow } from 'electron'
import { audioPageUrl, parsePlayerTitle, playbackProblem } from '@shared/audio-preview'

/** How long a play request waits to hear the sound has started before reporting success. */
const START_TIMEOUT_MS = 3000

export type PlayOutcome = { ok: true } | { ok: false; problem: string }

/**
 * Plays assets' sounds through the computer for the Premiere panel (panels can't play media).
 * Uses one hidden, sandboxed window without preload or Node that loads a tiny local page, which
 * plays asset://original/<id> through an <audio> element. Each play replaces the previous sound.
 */
export class AudioPlayer {
  private window: BrowserWindow | null = null
  private waiting: ((outcome: PlayOutcome) => void) | null = null

  /** `pageUrl` is the player page (audio.html) as a file:// or dev-server URL. */
  constructor(private readonly pageUrl: string) {}

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        // It never gets a click; without this Chromium would refuse to start the sound.
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false
      }
    })
    window.webContents.on('page-title-updated', (_event, title) => {
      const state = parsePlayerTitle(title)
      if (!state || !this.waiting) return
      if (state.state === 'playing' || state.state === 'ended') this.settle({ ok: true })
      else if (state.state === 'error')
        this.settle({ ok: false, problem: playbackProblem(state.code) })
    })
    window.webContents.on('render-process-gone', () => {
      this.settle({ ok: false, problem: 'the player stopped unexpectedly' })
      this.window = null
      window.destroy()
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
    this.window = window
    return window
  }

  private settle(outcome: PlayOutcome): void {
    const waiting = this.waiting
    this.waiting = null
    waiting?.(outcome)
  }

  /** Stops whatever is playing and plays this asset. Resolves once it's playing (or failed). */
  play(id: string): Promise<PlayOutcome> {
    const url = audioPageUrl(this.pageUrl, id)
    // A newer request replaces an older one still starting; the older one did start.
    this.settle({ ok: true })
    const window = this.ensureWindow()
    return new Promise<PlayOutcome>((resolve) => {
      const waiter = (outcome: PlayOutcome): void => {
        clearTimeout(timer)
        resolve(outcome)
      }
      // Only this request's own waiter: a newer play aborts this page load on purpose.
      const settleMine = (outcome: PlayOutcome): void => {
        if (this.waiting === waiter) this.settle(outcome)
      }
      const timer = setTimeout(() => settleMine({ ok: true }), START_TIMEOUT_MS)
      this.waiting = waiter
      window.loadURL(url).catch(() => {
        settleMine({ ok: false, problem: "the player couldn't start" })
      })
    })
  }

  /** Stops the sound, if any. */
  stop(): void {
    this.settle({ ok: true })
    if (this.window && !this.window.isDestroyed()) {
      void this.window.loadURL(audioPageUrl(this.pageUrl)).catch(() => undefined)
    }
  }

  /** True when `window` is the player's own (hidden) window. */
  owns(window: BrowserWindow): boolean {
    return window === this.window
  }

  destroy(): void {
    this.settle({ ok: true })
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}

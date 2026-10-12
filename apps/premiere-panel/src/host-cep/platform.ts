// Premiere Pro's CEP runtime (Premiere 24–26): Chromium with Node, ExtendScript through the
// bridge Premiere injects, and a drag channel Premiere reads as a file drop. This is the panel's
// home until Premiere 27 brings drag-and-drop to UXP (src/host-uxp has that build).
import type { CatalogAsset } from '@catalog/types'
import { ENGINE_START_URL } from '@catalog/requests'
import { fileUrl } from '../paths'

const cep = globalThis as unknown as CepGlobals

export function bridge(): AdobeCepBridge | null {
  return cep.__adobe_cep__ ?? null
}

export function detectWindows(): boolean {
  try {
    return require('os').platform().toLowerCase().startsWith('win')
  } catch {
    // Node not available here (a browser-only test); fall back to the browser's guess.
  }
  try {
    return (globalThis.navigator?.platform ?? '').toLowerCase().startsWith('win')
  } catch {
    return false
  }
}

function backing(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** localStorage that never throws: reads return null and writes are skipped when it's unavailable. */
export const storage = {
  get(key: string): string | null {
    try {
      return backing()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      backing()?.setItem(key, value)
    } catch {
      // storage full or unavailable; the setting just isn't remembered
    }
  },
  remove(key: string): void {
    try {
      backing()?.removeItem(key)
    } catch {
      // nothing to remove
    }
  }
}

export function hostInfo(): { app: string; version: string } {
  try {
    const env = JSON.parse(bridge()?.getHostEnvironment() ?? '{}') as {
      appName?: string
      appVersion?: string
    }
    return { app: env.appName ?? 'PPRO', version: env.appVersion ?? '0' }
  } catch {
    return { app: 'PPRO', version: '0' }
  }
}

/** What this runtime can do; the panel adapts its hints and fallbacks. */
export const capabilities = {
  /** Premiere takes file drags from CEP panels onto the Project panel and the timeline. */
  drag: true,
  /** Chromium plays WAV and MP3 itself; anything else falls back to the engine. */
  audio: true
}

/** Only web pages and the engine's start link ever leave the panel; nothing else is opened. */
export function allowedLink(url: string): boolean {
  if (url === ENGINE_START_URL) return true
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** Opens a web page, or the engine's start link, through the OS. */
export async function openExternal(url: string): Promise<void> {
  if (!allowedLink(url)) throw new Error("That link can't be opened from the panel.")
  const util = cep.cep?.util
  if (util) {
    const { err } = util.openURLInDefaultBrowser(url)
    if (err === 0) return
  }
  // The URL goes to the OS opener as one argument: never through a shell.
  const [command, args] = detectWindows()
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['open', [url]]
  await new Promise<void>((resolve, reject) => {
    try {
      require('child_process').execFile(command, args, (error) =>
        error ? reject(error) : resolve()
      )
    } catch (error) {
      reject(error as Error)
    }
  })
}

/** Asks the OS to start the engine (it registers the assetlibrary:// scheme). */
export async function startEngine(): Promise<boolean> {
  try {
    await openExternal(ENGINE_START_URL)
    return true
  } catch {
    return false
  }
}

/**
 * Drag onto Premiere's Project panel or timeline. CEP panels hand Premiere file paths under
 * `com.adobe.cep.dnd.file.<n>`, one per file, and Premiere treats the drop like one from the
 * Finder or Explorer.
 */
export function makeDraggable(node: HTMLElement, assets: () => CatalogAsset[]): void {
  node.setAttribute('draggable', 'true')
  node.addEventListener('dragstart', (event) => {
    const list = assets()
    if (list.length === 0 || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    list.forEach((asset, index) =>
      event.dataTransfer?.setData(`com.adobe.cep.dnd.file.${index}`, asset.path)
    )
    event.dataTransfer.effectAllowed = 'copy'
  })
}

let player: HTMLAudioElement | null = null

/** Sound played by the panel itself; `play` resolves false when Chromium can't decode the file. */
export const audio = {
  play(path: string, onEnd: () => void): Promise<boolean> {
    audio.stop()
    return new Promise((resolve) => {
      const element = new Audio()
      player = element
      let settled = false
      const settle = (played: boolean): void => {
        if (settled) return
        settled = true
        resolve(played)
      }
      element.addEventListener('ended', () => {
        if (player === element) player = null
        onEnd()
      })
      element.addEventListener('error', () => {
        if (player === element) player = null
        settle(false)
        if (settled) onEnd()
      })
      element.src = fileUrl(path)
      element.play().then(
        () => settle(true),
        () => settle(false)
      )
    })
  },
  /** Returns true when something was playing. */
  stop(): boolean {
    if (!player) return false
    player.pause()
    player.removeAttribute('src')
    player = null
    return true
  }
}

/** Keys Premiere would otherwise keep for itself; the panel asks for them while it has focus. */
const KEYS = [
  { keyCode: 13 }, // Enter
  { keyCode: 27 }, // Escape
  { keyCode: 32 }, // Space
  { keyCode: 70 }, // F
  { keyCode: 191 }, // /
  { keyCode: 37 },
  { keyCode: 38 },
  { keyCode: 39 },
  { keyCode: 40 },
  { keyCode: 37, shiftKey: true },
  { keyCode: 38, shiftKey: true },
  { keyCode: 39, shiftKey: true },
  { keyCode: 40, shiftKey: true }
]

export function claimKeys(): void {
  try {
    bridge()?.registerKeyEventsInterest(JSON.stringify(KEYS))
  } catch {
    // An older runtime without the call: Premiere keeps the keys.
  }
}

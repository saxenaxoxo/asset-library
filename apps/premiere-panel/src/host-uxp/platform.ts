// Premiere Pro's UXP runtime (the panel's home from Premiere 27): host facts, settings storage,
// starting the engine, and the drag payload Premiere 27 reads. The CEP runtime has the same
// module in src/host-cep; the build picks one.
import type { CatalogAsset } from '@catalog/types'
import { ENGINE_START_URL } from '@catalog/requests'
import { dragContentType, DRAG_MIN_MAJOR, fileUri, hostMajor } from '../paths'

/** UXP's own module, loaded on first use (unit tests load this file outside the host). */
function uxp(): UxpModule {
  return require('uxp')
}

/** True when the panel runs on Windows. Prefers UXP's os module, then the browser's guess. */
export function detectWindows(): boolean {
  try {
    const platform = require('os').platform?.()
    if (platform) return platform.toLowerCase().startsWith('win')
  } catch {
    // os module not available in this host
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
  return { app: 'premierepro', version: String(uxp().host.version) }
}

/** What this runtime can do; the panel adapts its hints and fallbacks. */
export const capabilities = {
  /** Premiere reads the drag payload from 27.0; the drag is wired on every version anyway. */
  get drag(): boolean {
    try {
      return hostMajor(hostInfo().version) >= DRAG_MIN_MAJOR
    } catch {
      return false
    }
  },
  /** UXP can't play media; sound goes through the engine. */
  audio: false
}

/** Asks the OS to start the engine (it registers the assetlibrary:// scheme). */
export async function startEngine(): Promise<boolean> {
  try {
    const shell = uxp().shell
    if (!shell) return false
    await shell.openExternal(ENGINE_START_URL, 'Start the Asset Library engine')
    return true
  } catch {
    return false
  }
}

export async function openExternal(url: string): Promise<void> {
  await uxp().shell?.openExternal(url, 'Open the release page')
}

/**
 * Drag onto Premiere's Project panel or timeline: a JSON payload of file URIs on `text/plain`
 * (Adobe's documented format for Premiere 27+). Assets Premiere can't take are left out.
 */
export function makeDraggable(node: HTMLElement, assets: () => CatalogAsset[]): void {
  node.setAttribute('draggable', 'true')
  node.addEventListener('dragstart', (event) => {
    const items = assets().flatMap((asset) => {
      const contentType = dragContentType(asset.name)
      return contentType
        ? [{ name: asset.name, content_type: contentType, uri: fileUri(asset.path) }]
        : []
    })
    if (items.length === 0 || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', JSON.stringify({ version: '1.0.0', items }))
    event.dataTransfer.effectAllowed = 'copyMove'
  })
}

/** Sound can't be played by a UXP panel: the engine does it. */
export const audio = {
  play(path: string, onEnd: () => void): Promise<boolean> {
    void path
    void onEnd
    return Promise.resolve(false)
  },
  stop(): boolean {
    return false
  }
}

export function claimKeys(): void {
  // UXP panels receive their own keys; nothing to claim.
}

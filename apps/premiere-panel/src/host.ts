// Guarded access to host globals that can be missing or throw in some UXP versions.

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

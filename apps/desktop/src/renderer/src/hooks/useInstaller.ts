import { useCallback, useEffect, useState } from 'react'
import type { InstallerResult, InstallerStatus } from '@shared/api'
import type { PanelBuild } from '@shared/installer'
import type { Busy } from '../lib/install-plan'

export interface Installer {
  status: InstallerStatus | null
  /** Set when the status couldn't be read. */
  error: string | null
  busy: Busy
  /** The outcome of the last install or removal, as main reported it. */
  result: (InstallerResult & { action: 'install' | 'remove' }) | null
  refresh(): Promise<void>
  install(builds: PanelBuild[]): Promise<void>
  remove(build: PanelBuild): Promise<void>
  clearResult(): void
}

const api = (): typeof window.assetLibrary => window.assetLibrary

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The installer window's state: what main reports, and actions that refresh it afterwards. */
export function useInstaller(): Installer {
  const [status, setStatus] = useState<InstallerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [result, setResult] = useState<Installer['result']>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api().getInstallerStatus()
      setStatus(next)
      setError(null)
    } catch (caught) {
      setError(`Couldn't check what's installed: ${message(caught)}`)
    }
  }, [])

  // The first check when the window opens.
  useEffect(() => {
    let cancelled = false
    api()
      .getInstallerStatus()
      .then(
        (next) => {
          if (!cancelled) setStatus(next)
        },
        (caught: unknown) => {
          if (!cancelled) setError(`Couldn't check what's installed: ${message(caught)}`)
        }
      )
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (action: 'install' | 'remove', work: () => Promise<InstallerResult>) => {
      setBusy(action)
      setResult(null)
      try {
        setResult({ ...(await work()), action })
      } catch (caught) {
        setResult({ ok: false, message: message(caught), action })
      } finally {
        setBusy(null)
        await refresh()
      }
    },
    [refresh]
  )

  return {
    status,
    error,
    busy,
    result,
    refresh,
    install: (builds) => run('install', () => api().installPanel(builds)),
    remove: (build) => run('remove', () => api().removePanel(build)),
    clearResult: () => setResult(null)
  }
}

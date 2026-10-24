import { useCallback, useEffect, useState } from 'react'
import type { InstallerResult, InstallerStatus, InstallProgress } from '@shared/api'
import type { PanelBuild } from '@shared/installer'
import type { Busy } from '../lib/install-plan'

export interface Installer {
  status: InstallerStatus | null
  /** Set when the status couldn't be read. */
  error: string | null
  busy: Busy
  /** The download or install in progress, as main reports it (real byte counts). */
  progress: InstallProgress
  /** The outcome of the last install or removal, as main reported it. */
  result: (InstallerResult & { action: 'install' | 'remove' }) | null
  /** Checks again, reading the download list again too. */
  refresh(): Promise<void>
  install(builds: PanelBuild[]): Promise<void>
  remove(build: PanelBuild): Promise<void>
  /** Stops the download in progress. */
  cancel(): void
  clearResult(): void
}

/** How often the window asks for progress while installing. */
const PROGRESS_POLL_MS = 200

const api = (): typeof window.assetLibrary => window.assetLibrary

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The installer window's state: what main reports, and actions that refresh it afterwards. */
export function useInstaller(): Installer {
  const [status, setStatus] = useState<InstallerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<InstallProgress>(null)
  const [result, setResult] = useState<Installer['result']>(null)

  const load = useCallback(async (refresh: boolean) => {
    try {
      const next = await api().getInstallerStatus({ refresh })
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

  // While installing, follow the download and install as main reports them.
  useEffect(() => {
    if (busy !== 'install') return
    let stopped = false
    const poll = (): void => {
      api()
        .getInstallProgress()
        .then(
          (next) => {
            if (!stopped) setProgress(next)
          },
          () => undefined
        )
    }
    poll()
    const timer = setInterval(poll, PROGRESS_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
      setProgress(null)
    }
  }, [busy])

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
        await load(false)
      }
    },
    [load]
  )

  return {
    status,
    error,
    busy,
    progress,
    result,
    refresh: () => load(true),
    install: (builds) => run('install', () => api().installPanel(builds)),
    remove: (build) => run('remove', () => api().removePanel(build)),
    cancel: () => void api().cancelDownload(),
    clearResult: () => setResult(null)
  }
}

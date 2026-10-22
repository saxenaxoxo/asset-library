import { useCallback, useEffect, useState } from 'react'
import type { EngineState } from '@shared/api'

/** How often the window asks what the engine is doing (it's cheap: no disk or network). */
const ENGINE_POLL_MS = 3000

/** What the engine is busy with, or null when it's idle ("Up to date" needs no mention). */
export function engineActivity(state: EngineState | null): string | null {
  return state && state.line !== 'Up to date' ? state.line : null
}

export interface Engine {
  state: EngineState | null
  setStartAtLogin(enabled: boolean): void
}

/** The background engine this window belongs to: what it's doing and whether it starts at login. */
export function useEngine(): Engine {
  const [state, setState] = useState<EngineState | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.assetLibrary.getEngineState().then(
        (next) => alive && setState(next),
        () => undefined
      )
    }
    load()
    const timer = setInterval(load, ENGINE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const setStartAtLogin = useCallback((enabled: boolean) => {
    // Shown at once; main's answer (the saved setting) follows.
    setState((current) => (current ? { ...current, startAtLogin: enabled } : current))
    window.assetLibrary.setStartAtLogin(enabled).then(setState, () => undefined)
  }, [])

  return { state, setStartAtLogin }
}

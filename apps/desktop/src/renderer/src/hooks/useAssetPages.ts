import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssetQuery, AssetRecord } from '@shared/library'

const PAGE_SIZE = 150

export interface AssetPages {
  total: number
  loading: boolean
  error: string | null
  /** The asset at a position, or undefined while its page loads. */
  itemAt: (index: number) => AssetRecord | undefined
  /** Ask for the pages covering [start, end]; call with the virtualizer's visible range. */
  ensureRange: (start: number, end: number) => void
}

/**
 * Loads query results page by page as they scroll into view, so 100k-asset libraries stay fast.
 * `refreshKey` changes (e.g. after a scan) refetch the visible pages without clearing the screen.
 */
export function useAssetPages(query: AssetQuery, refreshKey: number): AssetPages {
  const [total, setTotal] = useState(0)
  // Loading = the current query hasn't returned its first page yet.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, setVersion] = useState(0)
  const pages = useRef(new Map<number, AssetRecord[]>())
  const inflight = useRef(new Set<number>())
  const generation = useRef(0)
  const lastRange = useRef<[number, number]>([0, 0])
  const queryKey = JSON.stringify(query)

  const loadPage = useCallback(
    (page: number, gen: number) => {
      if (inflight.current.has(page)) return
      inflight.current.add(page)
      window.assetLibrary
        .queryAssets({ ...query, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
        .then((result) => {
          if (gen !== generation.current) return
          pages.current.set(page, result.items)
          setTotal(result.total)
          setLoadedKey(queryKey)
          setError(null)
          setVersion((v) => v + 1)
        })
        .catch((err: Error) => {
          if (gen === generation.current) {
            setError(err.message)
            setLoadedKey(queryKey)
          }
        })
        .finally(() => inflight.current.delete(page))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey]
  )

  // New query: start over from the first page.
  useEffect(() => {
    generation.current++
    pages.current = new Map()
    inflight.current = new Set()
    loadPage(0, generation.current)
  }, [loadPage])

  // Library changed: refetch what's on screen, keeping current items visible meanwhile.
  useEffect(() => {
    if (refreshKey === 0) return
    generation.current++
    const gen = generation.current
    inflight.current = new Set()
    const [start, end] = lastRange.current
    const first = Math.floor(start / PAGE_SIZE)
    const last = Math.floor(end / PAGE_SIZE)
    const keep = new Map<number, AssetRecord[]>()
    for (let p = first; p <= last; p++) {
      const existing = pages.current.get(p)
      if (existing) keep.set(p, existing)
    }
    pages.current = keep
    for (let p = first; p <= last; p++) loadPage(p, gen)
  }, [refreshKey, loadPage])

  const itemAt = useCallback((index: number) => {
    return pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE]
  }, [])

  const ensureRange = useCallback(
    (start: number, end: number) => {
      lastRange.current = [start, end]
      const first = Math.floor(start / PAGE_SIZE)
      const last = Math.floor(end / PAGE_SIZE)
      for (let p = first; p <= last; p++) {
        if (!pages.current.has(p)) loadPage(p, generation.current)
      }
    },
    [loadPage]
  )

  const loading = loadedKey !== queryKey
  return { total: loading ? 0 : total, loading, error, itemAt, ensureRange }
}

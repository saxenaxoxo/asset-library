import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetQuery, AssetRecord } from '@shared/library'
import { PageCache } from '../lib/page-cache'

const PAGE_SIZE = 150

export interface AssetPages {
  total: number
  loading: boolean
  error: string | null
  /** The asset at a position, or undefined while its page loads. */
  itemAt: (index: number) => AssetRecord | undefined
  /** Position of an asset among the pages loaded so far, or undefined if it isn't loaded. */
  indexOf: (id: string) => number | undefined
  /** Ask for the pages covering [start, end]; call with the virtualizer's visible range. */
  ensureRange: (start: number, end: number) => void
  /** Changes whenever loaded items change, so memoized views know to re-render. */
  version: number
}

/**
 * Loads query results page by page as they scroll into view, so 100k-asset libraries stay fast.
 * `refreshKey` changes (e.g. after a scan) refetch the visible pages without clearing the screen;
 * pages scrolled past stay visible and are refetched when they come back into view.
 */
export function useAssetPages(query: AssetQuery, refreshKey: number): AssetPages {
  const [total, setTotal] = useState(0)
  // Loading = the current query hasn't returned its first page yet.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const cache = useRef(new PageCache<AssetRecord>(PAGE_SIZE))
  const inflight = useRef(new Set<number>())
  const generation = useRef(0)
  const lastRange = useRef<[number, number]>([0, 0])
  const queryKey = JSON.stringify(query)

  const loadPage = useCallback(
    (page: number, gen: number) => {
      // Capture this generation's set: a refresh swaps in a new one while this request runs.
      const pending = inflight.current
      if (pending.has(page)) return
      pending.add(page)
      window.assetLibrary
        .queryAssets({ ...query, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
        .then((result) => {
          if (gen !== generation.current) return
          cache.current.set(page, result.items)
          cache.current.trim(result.total)
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
        .finally(() => pending.delete(page))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey]
  )

  // New query: start over from the first page.
  useEffect(() => {
    generation.current++
    cache.current.clear()
    inflight.current = new Set()
    loadPage(0, generation.current)
  }, [loadPage])

  // Library changed: refetch what's on screen. Everything loaded stays visible meanwhile, and
  // pages off screen are refetched when scrolled back to.
  useEffect(() => {
    if (refreshKey === 0) return
    generation.current++
    const gen = generation.current
    inflight.current = new Set()
    cache.current.markAllStale()
    const [start, end] = lastRange.current
    for (const page of cache.current.pagesFor(start, end)) loadPage(page, gen)
  }, [refreshKey, loadPage])

  const itemAt = useCallback((index: number) => cache.current.itemAt(index), [])
  const indexOf = useCallback((id: string) => cache.current.indexOf(id), [])

  const ensureRange = useCallback(
    (start: number, end: number) => {
      lastRange.current = [start, end]
      for (const page of cache.current.pagesFor(start, end)) {
        if (cache.current.needsLoad(page)) loadPage(page, generation.current)
      }
    },
    [loadPage]
  )

  const loading = loadedKey !== queryKey
  const shownTotal = loading ? 0 : total
  return useMemo(
    () => ({ total: shownTotal, loading, error, itemAt, indexOf, ensureRange, version }),
    [shownTotal, loading, error, itemAt, indexOf, ensureRange, version]
  )
}

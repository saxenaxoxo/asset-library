import { describe, expect, it } from 'vitest'
import { FavoriteToggle } from '../../src/renderer/src/lib/favorite-toggle'
import { PageCache } from '../../src/renderer/src/lib/page-cache'

describe('FavoriteToggle', () => {
  it('toggles twice for a quick double F, even before the record is read again', () => {
    const toggle = new FavoriteToggle()
    // The record in hand still says "not a favorite" for both presses.
    expect(toggle.next('a', false)).toBe(true)
    expect(toggle.next('a', false)).toBe(false)
    expect(toggle.next('a', false)).toBe(true)
    expect(toggle.current('a', false)).toBe(true)
  })

  it('forgets a press once saved, unless a later press is still being saved', () => {
    const toggle = new FavoriteToggle()
    const first = toggle.next('a', false)
    const second = toggle.next('a', false)
    toggle.saved('a', first)
    expect(toggle.current('a', true)).toBe(second)
    toggle.saved('a', second)
    expect(toggle.current('a', true)).toBe(true)
    expect(toggle.next('b', true)).toBe(false)
  })
})

describe('PageCache', () => {
  const items = (page: number): { id: string }[] =>
    Array.from({ length: 3 }, (_, i) => ({ id: `p${page}-${i}` }))

  it('keeps pages on screen after a change, but marks them to fetch again', () => {
    const cache = new PageCache<{ id: string }>(3)
    cache.set(0, items(0))
    cache.set(1, items(1))
    cache.markAllStale()
    // Scrolling back shows the old items (no skeletons) while they're fetched again.
    expect(cache.itemAt(4)).toEqual({ id: 'p1-1' })
    expect(cache.needsLoad(1)).toBe(true)
    cache.set(1, items(1))
    expect(cache.needsLoad(1)).toBe(false)
    expect(cache.needsLoad(0)).toBe(true)
    expect(cache.needsLoad(5)).toBe(true)
  })

  it('finds pages for a range and positions by ID; a new query clears it', () => {
    const cache = new PageCache<{ id: string }>(3)
    expect(cache.pagesFor(2, 7)).toEqual([0, 1, 2])
    cache.set(2, items(2))
    expect(cache.indexOf('p2-1')).toBe(7)
    cache.clear()
    expect(cache.itemAt(7)).toBeUndefined()
  })

  it('drops pages past the end when the results shrink', () => {
    const cache = new PageCache<{ id: string }>(3)
    for (const page of [0, 1, 2]) cache.set(page, items(page))
    cache.trim(4)
    expect(cache.itemAt(3)).toEqual({ id: 'p1-0' })
    expect(cache.itemAt(6)).toBeUndefined()
  })
})

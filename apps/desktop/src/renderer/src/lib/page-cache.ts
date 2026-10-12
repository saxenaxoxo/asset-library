/**
 * The loaded pages of a query's results. After the library changes, pages are kept but marked
 * stale: they stay on screen (no skeletons when scrolling back) and are fetched again when seen.
 */
export class PageCache<T extends { id: string }> {
  private pages = new Map<number, T[]>()
  private stale = new Set<number>()

  constructor(readonly pageSize: number) {}

  /** A new query: forget everything. */
  clear(): void {
    this.pages = new Map()
    this.stale = new Set()
  }

  /** The library changed: keep showing every page, but fetch each again before trusting it. */
  markAllStale(): void {
    this.stale = new Set(this.pages.keys())
  }

  set(page: number, items: T[]): void {
    this.pages.set(page, items)
    this.stale.delete(page)
  }

  /** True when the page is missing or stale (so it should be fetched). */
  needsLoad(page: number): boolean {
    return !this.pages.has(page) || this.stale.has(page)
  }

  /** Pages covering positions [start, end]. */
  pagesFor(start: number, end: number): number[] {
    const first = Math.floor(Math.max(0, start) / this.pageSize)
    const last = Math.floor(Math.max(0, end) / this.pageSize)
    const pages: number[] = []
    for (let p = first; p <= last; p++) pages.push(p)
    return pages
  }

  itemAt(index: number): T | undefined {
    return this.pages.get(Math.floor(index / this.pageSize))?.[index % this.pageSize]
  }

  indexOf(id: string): number | undefined {
    for (const [page, items] of this.pages) {
      const offset = items.findIndex((item) => item.id === id)
      if (offset !== -1) return page * this.pageSize + offset
    }
    return undefined
  }

  /** Drops pages past the end after the results shrank (they'd show assets that moved). */
  trim(total: number): void {
    const lastPage = Math.max(0, Math.ceil(total / this.pageSize) - 1)
    for (const page of [...this.pages.keys()]) {
      if (page > lastPage) {
        this.pages.delete(page)
        this.stale.delete(page)
      }
    }
  }
}

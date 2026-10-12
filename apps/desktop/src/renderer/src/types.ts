export type ViewId =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'video'
  | 'audio'
  | 'images'
  | 'templates'
  | 'missing'
  | 'settings'
  | `root:${number}`
  | `tag:${string}`

export type ViewMode = 'grid' | 'list'

/** What the grid and list views let the app do from the keyboard. */
export interface AssetViewHandle {
  /** Tiles per row (1 in the list), so up and down arrows move by a whole row. */
  columns: number
  scrollToIndex: (index: number) => void
}

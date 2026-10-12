export interface LibraryRoot {
  path: string
  name: string
}

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
  | `root:${string}`

export type ViewMode = 'grid' | 'list'

export type SortKey = 'added' | 'name' | 'modified' | 'size' | 'duration'

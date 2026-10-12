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

interface StatusBarProps {
  assetCount: number
  folderCount: number
  version: string | null
}

export function StatusBar({ assetCount, folderCount, version }: StatusBarProps): React.JSX.Element {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-4 text-2xs text-ink-3">
      <span>
        {assetCount.toLocaleString()} {assetCount === 1 ? 'asset' : 'assets'}
      </span>
      <span>
        {folderCount} {folderCount === 1 ? 'folder' : 'folders'}
      </span>
      <span className="flex-1" />
      {version && <span>Version {version}</span>}
    </footer>
  )
}

import type { ScanProgress } from '@shared/library'

interface StatusBarProps {
  total: number
  shown: number
  folderCount: number
  progress: ScanProgress[]
  version: string | null
}

export function StatusBar({
  total,
  shown,
  folderCount,
  progress,
  version
}: StatusBarProps): React.JSX.Element {
  const scanning = progress.filter((p) => p.state === 'scanning')
  const problem = progress.find((p) => p.state === 'offline' || p.state === 'failed')
  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-4 text-2xs text-ink-3"
      role="status"
    >
      <span>
        {shown === total
          ? `${total.toLocaleString()} ${total === 1 ? 'asset' : 'assets'}`
          : `${shown.toLocaleString()} of ${total.toLocaleString()} assets`}
      </span>
      <span>
        {folderCount} {folderCount === 1 ? 'folder' : 'folders'}
      </span>
      {scanning.length > 0 && (
        <span className="text-brand-300">
          Scanning, {scanning.reduce((n, p) => n + p.filesSeen, 0).toLocaleString()} files found
        </span>
      )}
      {scanning.length === 0 && problem?.message && (
        <span className="truncate text-ink-2">{problem.message}</span>
      )}
      <span className="flex-1" />
      {version && <span>Version {version}</span>}
    </footer>
  )
}

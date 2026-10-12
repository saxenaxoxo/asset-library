import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { Diagnostics } from '@shared/api'
import type { RootRecord } from '@shared/library'
import { DragTest } from './DragTest'

interface SettingsViewProps {
  roots: RootRecord[]
  onRemoveRoot: (root: RootRecord) => void
}

export function SettingsView({ roots, onRemoveRoot }: SettingsViewProps): React.JSX.Element {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)

  useEffect(() => {
    void window.assetLibrary.getDiagnostics().then(setDiagnostics)
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      <section className="max-w-[640px] px-8 pt-8">
        <h2 className="text-lg font-semibold">Library folders</h2>
        <p className="mt-1.5 text-sm text-ink-2">
          Removing a folder only removes it from Asset Library. Your files stay where they are.
        </p>
        <div className="mt-4 divide-y divide-line rounded-lg border border-line">
          {roots.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">No folders yet.</p>}
          {roots.map((root) => (
            <div key={root.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{root.label}</div>
                <div className="truncate text-xs text-ink-3" title={root.path}>
                  {root.status === 'offline' ? 'Not connected. ' : ''}
                  {root.path}
                </div>
              </div>
              <span className="text-xs text-ink-3">{root.assetCount.toLocaleString()} assets</span>
              <button
                type="button"
                aria-label={`Rescan ${root.label}`}
                title="Rescan"
                onClick={() => void window.assetLibrary.rescan(root.id)}
                className="rounded p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${root.label}`}
                title="Remove from library"
                onClick={() => onRemoveRoot(root)}
                className="rounded p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <DragTest />

      <section className="max-w-[640px] px-8 pb-10">
        <h2 className="text-lg font-semibold">About this build</h2>
        <dl className="mt-3 grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
          <dt className="text-ink-3">Database</dt>
          <dd className="text-ink-2">
            {diagnostics
              ? `SQLite ${diagnostics.sqliteVersion}${diagnostics.fts5 ? ', search ready' : ', search unavailable'}`
              : '—'}
          </dd>
          <dt className="text-ink-3">Media engine</dt>
          <dd className="text-ink-2">
            {diagnostics
              ? diagnostics.ffprobeVersion
                ? `FFmpeg ${diagnostics.ffprobeVersion} (LGPL)`
                : 'Not found. Media details and previews are unavailable.'
              : '—'}
          </dd>
        </dl>
      </section>
    </div>
  )
}

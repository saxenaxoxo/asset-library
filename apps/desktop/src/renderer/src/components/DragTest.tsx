import { useState } from 'react'
import { FileUp, GripVertical } from 'lucide-react'
import type { DragItem } from '@shared/api'

/**
 * Temporary M2 spike: drag real files from the app into Premiere Pro or After Effects to
 * check that OS-native drag-out works. Replaced by the asset grid in M4.
 */
export function DragTest(): React.JSX.Element {
  const [items, setItems] = useState<DragItem[]>([])

  async function chooseFiles(): Promise<void> {
    const picked = await window.assetLibrary.pickDragTestFiles()
    if (picked.length > 0) setItems(picked)
  }

  return (
    <section className="flex flex-col gap-5 px-8 py-8">
      <div className="max-w-[560px]">
        <h2 className="text-lg font-semibold">Drag-out test</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Check drag-and-drop with any files, even ones outside your library. Drag them into
          Premiere Pro&apos;s Project panel or timeline, or into After Effects. The original files
          are used; nothing is copied or changed.
        </p>
        <button
          type="button"
          onClick={() => void chooseFiles()}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm text-ink hover:bg-raised"
        >
          <FileUp size={15} />
          Choose test files
        </button>
      </div>

      {items.length > 0 && (
        <ul className="grid max-w-[720px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => {
                event.preventDefault()
                window.assetLibrary.startDrag([item.id])
              }}
              className="flex h-11 cursor-grab items-center gap-2 rounded-md border border-line bg-raised px-3 text-sm active:cursor-grabbing"
              title="Drag into Premiere Pro or After Effects"
            >
              <GripVertical size={14} className="shrink-0 text-ink-3" />
              <span className="truncate">{item.name}</span>
            </li>
          ))}
          {items.length > 1 && (
            <li
              draggable
              onDragStart={(event) => {
                event.preventDefault()
                window.assetLibrary.startDrag(items.map((item) => item.id))
              }}
              className="flex h-11 cursor-grab items-center gap-2 rounded-md border border-brand-600 bg-brand-surface px-3 text-sm text-brand-200 active:cursor-grabbing"
            >
              <GripVertical size={14} className="shrink-0" />
              Drag all {items.length} files
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

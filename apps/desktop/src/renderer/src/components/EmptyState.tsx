import { FolderPlus } from 'lucide-react'

interface EmptyStateProps {
  onAddFolder: () => void
}

/**
 * First-run screen. The shelf illustration reuses the logo's bar geometry at large scale,
 * coloured from the brand ramp so it follows any rebrand.
 */
const SHELF_BARS = [
  { x: 7, y: 28, h: 26, fill: 'var(--color-brand-200)' },
  { x: 17, y: 14, h: 40, fill: 'var(--color-brand-300)' },
  { x: 27, y: 22, h: 32, fill: 'var(--color-ink)' },
  { x: 37, y: 9, h: 45, fill: 'var(--color-brand-400)' },
  { x: 47, y: 30, h: 24, fill: 'var(--color-brand-500)', lean: true }
]

function Shelf(): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 60" className="h-[280px] w-[300px]" aria-hidden="true">
      {SHELF_BARS.map((bar, index) => (
        <g key={bar.x} transform={bar.lean ? 'rotate(16 47 54)' : undefined}>
          <rect
            x={bar.x}
            y={bar.y}
            width={7}
            height={bar.h}
            rx={3.5}
            fill={bar.fill}
            className="shelf-bar"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        </g>
      ))}
      <rect x={3} y={56} width={58} height={1.2} rx={0.6} fill="var(--color-line-strong)" />
    </svg>
  )
}

export function EmptyState({ onAddFolder }: EmptyStateProps): React.JSX.Element {
  return (
    <section className="flex flex-1 items-center justify-center px-12">
      <div className="flex max-w-[920px] items-center gap-16">
        <div className="max-w-[420px]">
          <h2 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink">
            Bring your assets together
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Add a folder or an external drive. Asset Library indexes what&apos;s inside without
            moving, renaming or changing a single file.
          </p>
          <button
            type="button"
            onClick={onAddFolder}
            className="mt-7 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-on-brand transition-colors hover:bg-brand-500"
          >
            <FolderPlus size={16} />
            Add folder
          </button>
          <p className="mt-4 text-xs text-ink-3">
            Video, audio, images and templates. Your files stay where they are.
          </p>
        </div>
        <Shelf />
      </div>
    </section>
  )
}

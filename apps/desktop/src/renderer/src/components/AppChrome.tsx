import { useEffect, useRef, type ReactNode } from 'react'
import {
  CircleCheck,
  CircleHelp,
  Download,
  Info,
  LifeBuoy,
  LoaderCircle,
  Package,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { brand } from '@brand/brand-config'
import { BrandMark } from './BrandMark'
import type { PrimaryAction } from '../lib/install-plan'
import { buttonClass, ICON } from '../lib/ui'

export type Screen = 'install' | 'manage' | 'about' | 'help'

/** Compact brand header. On macOS it leaves room for the window buttons and drags the window. */
export function BrandHeader({
  macOS,
  onHelp
}: {
  macOS: boolean
  onHelp: () => void
}): React.JSX.Element {
  return (
    <header
      className={`drag-region flex h-13 shrink-0 items-center gap-3 border-b border-line bg-panel pr-3 ${macOS ? 'pl-21' : 'pl-4'}`}
    >
      <BrandMark size={24} variant="hub" />
      <span className="truncate text-sm font-semibold text-ink">{brand.hubName}</span>
      <button
        type="button"
        onClick={onHelp}
        className="no-drag ml-auto inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
        aria-label="Help"
        title="Help"
      >
        <CircleHelp {...ICON} />
      </button>
    </header>
  )
}

const NAV: { id: Screen; label: string; icon: LucideIcon }[] = [
  { id: 'install', label: 'Install', icon: Download },
  { id: 'manage', label: 'Manage', icon: Package },
  { id: 'about', label: 'About', icon: Info },
  { id: 'help', label: 'Help', icon: LifeBuoy }
]

export function SidebarNavigation({
  current,
  onChange
}: {
  current: Screen
  onChange: (screen: Screen) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2"
    >
      {NAV.map(({ id, label, icon: Icon }) => {
        const active = id === current
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors ${
              active
                ? 'bg-brand-surface text-ink shadow-[inset_2px_0_0_var(--color-brand-500)]'
                : 'text-ink-2 hover:bg-raised hover:text-ink'
            }`}
          >
            <Icon {...ICON} className={active ? 'text-brand-400' : undefined} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}

/** Persistent bar under the content: Close on the left, the install actions on the right. */
export function BottomActionBar({
  primary,
  onPrimary,
  onClose,
  secondary,
  message
}: {
  primary: PrimaryAction
  onPrimary: () => void
  onClose: () => void
  secondary?: ReactNode
  message?: { ok: boolean; text: string } | null
}): React.JSX.Element {
  const busy =
    primary.state === 'installing' ||
    primary.state === 'uninstalling' ||
    primary.state === 'checking'
  return (
    <footer className="flex min-h-14 shrink-0 items-center gap-3 border-t border-line bg-panel px-4 py-2.5">
      <button type="button" onClick={onClose} className={buttonClass('quiet')}>
        Close
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`min-w-0 flex-1 truncate text-xs ${message ? (message.ok ? 'text-success' : 'text-danger') : 'text-ink-3'}`}
        title={message?.text ?? primary.reason}
      >
        {message?.text ?? primary.reason ?? ''}
      </p>
      {secondary}
      <button
        type="button"
        onClick={onPrimary}
        disabled={primary.disabled}
        className={buttonClass(primary.state === 'installed' ? 'done' : 'primary')}
      >
        {busy && <LoaderCircle {...ICON} className="animate-spin" />}
        {primary.state === 'installed' && <CircleCheck {...ICON} />}
        {primary.state === 'failed' && <TriangleAlert {...ICON} />}
        {primary.label}
      </button>
    </footer>
  )
}

/** A modal confirmation (native <dialog>: traps focus, closes on Esc). */
export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  extra
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  extra?: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-line-strong bg-raised p-0 text-ink shadow-2xl backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-ink-2">{children}</div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {extra}
        <button
          type="button"
          onClick={onCancel}
          className={`${buttonClass('quiet')} ml-auto`}
          autoFocus
        >
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={buttonClass('danger')}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-8 text-center">
      <Icon size={20} strokeWidth={1.75} aria-hidden className="text-ink-3" />
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      <div className="mt-1 max-w-sm text-xs text-ink-2">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** A titled block in a screen. */
export function Section({
  title,
  children,
  aside
}: {
  title: string
  children: ReactNode
  aside?: ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

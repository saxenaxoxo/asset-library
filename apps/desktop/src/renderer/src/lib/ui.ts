// Shared styling helpers for the installer window (not components, so they live outside them).

/** Icon props from the design rules: 16px, stroke 1.75, hidden from screen readers. */
export const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function buttonClass(kind: 'primary' | 'secondary' | 'quiet' | 'danger' | 'done'): string {
  const base =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed'
  switch (kind) {
    case 'primary':
      return `${base} bg-brand-600 text-on-brand hover:bg-brand-500 disabled:bg-raised disabled:text-ink-3`
    case 'done':
      return `${base} bg-raised text-success`
    case 'secondary':
      return `${base} border border-line-strong text-ink hover:bg-raised disabled:text-ink-3`
    case 'danger':
      return `${base} bg-danger/15 text-danger hover:bg-danger/25`
    case 'quiet':
      return `${base} text-ink-2 hover:bg-raised hover:text-ink`
  }
}

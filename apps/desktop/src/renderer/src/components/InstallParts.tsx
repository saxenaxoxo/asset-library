import {
  CircleAlert,
  CircleCheck,
  Clapperboard,
  FolderOpen,
  Info,
  Layers,
  TriangleAlert
} from 'lucide-react'
import type { InstallerStatus, RevealTarget } from '@shared/api'
import {
  buildFit,
  installState,
  PANEL_BUILDS,
  type BuildFit,
  type InstalledPanel,
  type PanelBuild
} from '@shared/installer'
import { brand } from '@brand/brand-config'
import { BrandMark } from './BrandMark'
import { formatBytes, type HostApp } from '../lib/install-plan'
import { buttonClass, ICON } from '../lib/ui'

const APPS: { id: HostApp; label: string; icon: typeof Clapperboard }[] = [
  { id: 'premiere', label: 'Premiere Pro', icon: Clapperboard },
  { id: 'after-effects', label: 'After Effects', icon: Layers }
]

/** Segmented control: which Adobe app the screen is about. */
export function ApplicationSelector({
  value,
  onChange
}: {
  value: HostApp
  onChange: (app: HostApp) => void
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Adobe application"
      className="inline-flex rounded-lg border border-line bg-panel p-0.5"
    >
      {APPS.map(({ id, label, icon: Icon }) => (
        <label
          key={id}
          className={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand-400 ${
            value === id ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink'
          }`}
        >
          <input
            type="radio"
            name="host-app"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
            className="sr-only"
          />
          <Icon {...ICON} className={value === id ? 'text-brand-400' : undefined} />
          {label}
        </label>
      ))}
    </div>
  )
}

export type SummaryTone = 'neutral' | 'ok' | 'warn'

/** Compact product line: icon, name, version, one sentence, and where things stand. */
export function ProductSummary({
  app,
  version,
  statusText,
  tone
}: {
  app: HostApp
  version: string | null
  statusText: string
  tone: SummaryTone
}): React.JSX.Element {
  const toneClass = tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-ink-2'
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? CircleAlert : Info
  return (
    <div className="flex items-start gap-4 rounded-lg border border-line bg-panel p-4">
      <BrandMark size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-base font-semibold text-ink">
            {brand.productName} for {app === 'premiere' ? 'Premiere Pro' : 'After Effects'}
          </h1>
          {version && <span className="text-xs text-ink-3">Panel {version}</span>}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          Organize, preview, and access your creative assets directly in your editing workflow.
        </p>
        <p className={`mt-2 flex items-center gap-1.5 text-xs ${toneClass}`}>
          <Icon size={14} strokeWidth={1.75} aria-hidden />
          {statusText}
        </p>
      </div>
    </div>
  )
}

const FIT_TEXT: Record<BuildFit, { icon: typeof CircleCheck; className: string }> = {
  recommended: { icon: CircleCheck, className: 'text-success' },
  limited: { icon: CircleAlert, className: 'text-warning' },
  untested: { icon: CircleAlert, className: 'text-warning' },
  unsupported: { icon: TriangleAlert, className: 'text-ink-3' }
}

/** One installation method (UXP or CEP) as a selectable card. */
export function InstallationMethodCard({
  build,
  selected,
  recommended,
  versions,
  installed,
  source,
  onSelect
}: {
  build: PanelBuild
  selected: boolean
  recommended: boolean
  versions: string[]
  installed: InstalledPanel[]
  /** What Install would use for this build: a download, the Hub's own copy, or nothing. */
  source: InstallerStatus['available']['cep']
  onSelect: () => void
}): React.JSX.Element {
  const info = PANEL_BUILDS[build]
  const availableVersion = source?.version ?? null
  const state = installState(installed, build, availableVersion)
  const copy = installed.find((panel) => panel.build === build)
  return (
    <label
      className={`relative flex cursor-pointer flex-col rounded-lg border p-4 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-400 ${
        selected
          ? 'border-brand-500 bg-brand-surface'
          : 'border-line bg-panel hover:border-line-strong'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="radio"
          name="panel-build"
          value={build}
          checked={selected}
          onChange={onSelect}
          className="size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-canvas transition-[border] checked:border-[5px] checked:border-brand-500 focus-visible:outline-none"
        />
        <span className="text-sm font-semibold text-ink">{info.label}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-2xs font-medium ${
            info.badge === 'Modern' ? 'bg-brand-600/20 text-brand-300' : 'bg-raised text-ink-2'
          }`}
        >
          {info.badge}
        </span>
        {recommended && (
          <span className="ml-auto text-2xs font-medium text-success">Recommended</span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-2">{info.summary}</p>
      <p className="mt-1 text-xs text-ink-3">{info.versions}</p>
      <ul className="mt-3 space-y-1 text-xs text-ink-2">
        {info.notes.map((note) => (
          <li key={note} className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
            {note}
          </li>
        ))}
      </ul>
      {versions.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs" aria-label="Compatibility">
          {versions.map((version) => {
            const { fit, reason } = buildFit(build, version)
            const { icon: Icon, className } = FIT_TEXT[fit]
            return (
              <li key={version} className={`flex items-start gap-1.5 ${className}`}>
                <Icon size={14} strokeWidth={1.75} aria-hidden className="mt-px shrink-0" />
                <span>{reason}</span>
              </li>
            )
          })}
        </ul>
      )}
      {source && (
        <p className="mt-3 text-xs text-ink-3 tabular-nums">
          {source.from === 'download'
            ? `Version ${source.version}, downloaded when you install (${formatBytes(source.size ?? 0)})`
            : `Version ${source.version}, built into ${brand.hubName}`}
        </p>
      )}
      {copy && (
        <p className="mt-1 text-xs text-ink-2">
          {state === 'update-available'
            ? `Installed: ${copy.version}. Version ${availableVersion} is available.`
            : `Installed: ${copy.version}`}
        </p>
      )}
    </label>
  )
}

/** One sentence on what to choose, in the tone the situation calls for. */
export function CompatibilityNotice({
  tone,
  children
}: {
  tone: 'info' | 'warn' | 'error'
  children: React.ReactNode
}): React.JSX.Element {
  const Icon = tone === 'info' ? Info : tone === 'warn' ? CircleAlert : TriangleAlert
  const color =
    tone === 'info' ? 'text-brand-300' : tone === 'warn' ? 'text-warning' : 'text-danger'
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="flex items-start gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-sm text-ink-2"
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className={`mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function LocationRow({
  label,
  path,
  note,
  onReveal,
  platform
}: {
  label: string
  path: string | null
  note?: string
  onReveal?: () => void
  platform: InstallerStatus['platform']
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{label}</p>
        {path ? <p className="mt-0.5 break-all text-xs text-ink-2 select-text">{path}</p> : null}
        {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
      </div>
      {path && onReveal && (
        <button
          type="button"
          onClick={onReveal}
          className={buttonClass('quiet')}
          aria-label={`Show ${label} in ${platform === 'win32' ? 'Explorer' : 'Finder'}`}
        >
          <FolderOpen {...ICON} />
          Show
        </button>
      )}
    </div>
  )
}

/**
 * Where things are. Adobe's installer picks the panel's folder itself, so nothing here pretends
 * to be configurable; every path shown was found on this computer.
 */
export function InstallationLocations({
  status,
  onReveal
}: {
  status: InstallerStatus
  onReveal: (target: RevealTarget, index?: number) => void
}): React.JSX.Element {
  const { locations, platform } = status
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-panel">
      {locations.premiereApps.length > 0 ? (
        locations.premiereApps.map((path, index) => (
          <LocationRow
            key={path}
            label="Premiere Pro"
            path={path}
            platform={platform}
            onReveal={() => onReveal('premiere-app', index)}
          />
        ))
      ) : (
        <LocationRow
          label="Premiere Pro"
          path={null}
          platform={platform}
          note="Not found in the usual applications folder. That's fine if Adobe's installer lists it above."
        />
      )}
      {locations.cepExtensions.map((path, index) => (
        <LocationRow
          key={path}
          label="Panel (CEP build)"
          path={path}
          platform={platform}
          onReveal={() => onReveal('cep-extension', index)}
        />
      ))}
      <LocationRow
        label="Panel destination"
        path={null}
        platform={platform}
        note="Adobe's plug-in installer (part of Creative Cloud) puts the panel where Premiere Pro looks for it. It chooses the folder, so there's nothing to set here."
      />
      <LocationRow
        label="Asset Library data"
        path={locations.data}
        platform={platform}
        note="Your library: folder list, tags, favorites and settings."
        onReveal={() => onReveal('data')}
      />
      <LocationRow
        label="Thumbnails and previews"
        path={locations.cache}
        platform={platform}
        note="Made from your files. Safe to clear; they're made again."
        onReveal={() => onReveal('cache')}
      />
    </div>
  )
}

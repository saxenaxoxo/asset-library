import { useId } from 'react'
import {
  Bug,
  Clapperboard,
  ExternalLink,
  FileText,
  Code,
  Layers,
  Package,
  RefreshCw,
  Scale,
  Trash2
} from 'lucide-react'
import type {
  EngineState,
  ExternalLink as LinkId,
  InstallerStatus,
  RevealTarget
} from '@shared/api'
import { engineCopy, trayPlace } from '@shared/engine-copy'
import { engineActivity } from '../hooks/useEngine'
import {
  installState,
  PANEL_BUILD_IDS,
  PANEL_BUILDS,
  recommendedBuild,
  type InstalledPanel,
  type PanelBuild
} from '@shared/installer'
import { brand } from '@brand/brand-config'
import { BrandMark } from './BrandMark'
import { EmptyState, Section } from './AppChrome'
import {
  ApplicationSelector,
  CompatibilityNotice,
  InstallationLocations,
  InstallationMethodCard,
  ProductSummary,
  type SummaryTone
} from './InstallParts'
import { isSelected, type Choice, type HostApp, type InstallPlan } from '../lib/install-plan'
import { buttonClass, ICON } from '../lib/ui'

/** "26.5.2 and 27.0.0", "24.0, 26.5 and 27.0". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function describeInstalled(installed: InstalledPanel[]): string {
  return list(
    installed.map(
      (panel) =>
        `${PANEL_BUILDS[panel.build].label} ${panel.version} for Premiere Pro ${list(panel.premiere)}`
    )
  )
}

const MANUAL_VERSIONS = [
  { value: '27.0', label: 'Premiere Pro 2027 or later' },
  { value: '26.0', label: 'Premiere Pro 2026' },
  { value: '25.0', label: 'Premiere Pro 2025' },
  { value: '24.0', label: 'Premiere Pro 2024' },
  { value: '23.0', label: 'Premiere Pro 2023 or earlier' }
]

export function InstallScreen({
  status,
  error,
  plan,
  app,
  onApp,
  choice,
  onChoice,
  manualVersion,
  onManualVersion,
  onRetry,
  onReveal,
  justInstalled = false
}: {
  status: InstallerStatus | null
  error: string | null
  /** The last install succeeded: show what to do next. */
  justInstalled?: boolean
  plan: InstallPlan
  app: HostApp
  onApp: (app: HostApp) => void
  choice: Choice
  onChoice: (choice: Choice) => void
  manualVersion: string | null
  onManualVersion: (version: string | null) => void
  onRetry: () => void
  onReveal: (target: RevealTarget, index?: number) => void
}): React.JSX.Element {
  const selectId = useId()
  if (app === 'after-effects') {
    return (
      <>
        <ApplicationSelector value={app} onChange={onApp} />
        <div className="mt-4">
          <ProductSummary app={app} version={null} statusText="Not available yet" tone="neutral" />
        </div>
        <div className="mt-4">
          <EmptyState icon={Layers} title="No After Effects panel yet">
            Asset Library has a panel for Premiere Pro today. An After Effects panel is planned, and
            this tab will offer it once it exists. There&apos;s nothing to install for After
            Effects.
          </EmptyState>
        </div>
      </>
    )
  }

  const detected = plan.versions
  const versions = detected.length > 0 ? detected : manualVersion ? [manualVersion] : []
  const manualBuild = manualVersion ? recommendedBuild(manualVersion) : null
  const recommended = detected.length > 0 ? plan.recommended : manualBuild ? [manualBuild] : []
  const shownVersion = status
    ? (status.available.uxp?.version ?? status.available.cep?.version ?? null)
    : null
  const catalog = status?.catalog

  let statusText = 'Checking what’s installed…'
  let tone: SummaryTone = 'neutral'
  if (error) statusText = "Couldn't check what's installed"
  else if (status && plan.installed.length > 0) {
    const outdated = plan.installed.some(
      (panel) =>
        installState([panel], panel.build, status.available[panel.build]?.version ?? null) ===
        'update-available'
    )
    statusText = `${outdated ? 'Update available. ' : ''}Installed: ${describeInstalled(plan.installed)}`
    tone = outdated ? 'warn' : 'ok'
  } else if (status) statusText = 'Not installed'

  return (
    <>
      <ApplicationSelector value={app} onChange={onApp} />
      <div className="mt-4">
        <ProductSummary app={app} version={shownVersion} statusText={statusText} tone={tone} />
      </div>
      {justInstalled && (
        <div className="mt-3">
          <CompatibilityNotice tone="info">
            <p className="font-medium text-ink">Installed. Next:</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>Quit and reopen Premiere Pro.</li>
              <li>
                Open the panel: Window → Extensions → {brand.productName} (Premiere Pro 2024 to
                2026) or Window → UXP Plugins → {brand.productName} (2027 and later).
              </li>
              <li>{engineCopy.afterInstall}</li>
            </ol>
          </CompatibilityNotice>
        </div>
      )}
      {status && catalog && (catalog.state === 'offline' || catalog.state === 'invalid') && (
        <div className="mt-3">
          <CompatibilityNotice tone="info">
            <p>
              {catalog.state === 'offline'
                ? "You're offline, so newer panel versions can't be checked."
                : (catalog.message ?? "The panel download list couldn't be read.")}{' '}
              {status.bundled.cep || status.bundled.uxp
                ? `Install uses the panel built into ${brand.hubName}.`
                : ''}
            </p>
            <button type="button" onClick={onRetry} className={`${buttonClass('quiet')} mt-2`}>
              <RefreshCw {...ICON} />
              Check again
            </button>
          </CompatibilityNotice>
        </div>
      )}

      <div className="mt-4">
        {error ? (
          <CompatibilityNotice tone="error">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className={`${buttonClass('secondary')} mt-2`}>
              <RefreshCw {...ICON} />
              Check again
            </button>
          </CompatibilityNotice>
        ) : !status ? null : detected.length === 0 ? (
          <CompatibilityNotice tone="warn">
            <p>
              {status.adobeInstaller
                ? "Premiere Pro wasn't found on this computer, so nothing can be installed yet."
                : "Adobe's plug-in installer (part of the Creative Cloud app) wasn't found, so Premiere Pro couldn't be checked."}{' '}
              Which version do you use? The recommendation below follows your answer.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor={selectId} className="sr-only">
                Your Premiere Pro version
              </label>
              <select
                id={selectId}
                value={manualVersion ?? ''}
                onChange={(event) => onManualVersion(event.target.value || null)}
                className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
              >
                <option value="">Choose a version</option>
                {MANUAL_VERSIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={onRetry} className={buttonClass('quiet')}>
                <RefreshCw {...ICON} />
                Check again
              </button>
            </div>
            {manualVersion && (
              <p className="mt-2">
                {manualBuild
                  ? `For that version, choose ${PANEL_BUILDS[manualBuild].label}.`
                  : 'Asset Library needs Premiere Pro 2024 or later.'}
              </p>
            )}
          </CompatibilityNotice>
        ) : (
          <RecommendationNotice
            detected={detected}
            recommended={plan.recommended}
            choice={choice}
            onChoice={onChoice}
          />
        )}
      </div>

      <Section title="Installation method">
        <div
          role="radiogroup"
          aria-label="Installation method"
          className="grid gap-3 md:grid-cols-2"
        >
          {PANEL_BUILD_IDS.map((build) => (
            <InstallationMethodCard
              key={build}
              build={build}
              selected={isSelected(choice, recommended, build)}
              recommended={recommended.includes(build)}
              versions={versions}
              installed={plan.installed}
              source={status?.available[build] ?? null}
              onSelect={() =>
                onChoice(
                  recommended.length === 1 && recommended[0] === build ? 'recommended' : build
                )
              }
            />
          ))}
        </div>
      </Section>

      {status && status.otherProducts.length > 0 && (
        <Section title={`More from ${brand.brandName}`}>
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {status.otherProducts.map((product) => (
              <li key={product.id} className="flex items-center gap-3 px-3.5 py-3 text-sm">
                <Package {...ICON} className="text-ink-2" />
                <span className="font-medium text-ink">{product.name}</span>
                <span className="ml-auto text-xs text-ink-3">
                  Needs a newer version of {brand.hubName}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {status && (
        <Section title="Where it goes">
          <InstallationLocations status={status} onReveal={onReveal} />
        </Section>
      )}
    </>
  )
}

function RecommendationNotice({
  detected,
  recommended,
  choice,
  onChoice
}: {
  detected: string[]
  recommended: PanelBuild[]
  choice: Choice
  onChoice: (choice: Choice) => void
}): React.JSX.Element {
  const found = `Found Premiere Pro ${list(detected)}.`
  if (recommended.length === 0) {
    return (
      <CompatibilityNotice tone="error">
        {found} Asset Library needs Premiere Pro 2024 or later, so neither build supports it.
      </CompatibilityNotice>
    )
  }
  const perVersion = detected
    .map((version) => {
      const build = recommendedBuild(version)
      return build ? `${PANEL_BUILDS[build].label} for ${version}` : null
    })
    .filter(Boolean) as string[]
  if (choice !== 'recommended' && !recommended.every((build) => build === choice)) {
    return (
      <CompatibilityNotice tone="warn">
        <p>
          {found} The recommended choice is {list(perVersion)}. You picked{' '}
          {PANEL_BUILDS[choice].label}; check the notes on its card before installing.
        </p>
        <button
          type="button"
          onClick={() => onChoice('recommended')}
          className={`${buttonClass('secondary')} mt-2`}
        >
          Use the recommended choice
        </button>
      </CompatibilityNotice>
    )
  }
  return (
    <CompatibilityNotice tone="info">
      {found} Recommended: {list(perVersion)}.
      {recommended.length > 1 && ' Install sets up both, each for its own version.'}
    </CompatibilityNotice>
  )
}

export function ManageScreen({
  status,
  error,
  installed,
  busy,
  onUpdate,
  onRemove,
  onUninstallApp,
  onGoInstall,
  onRetry,
  onReveal,
  engine,
  onStartAtLogin
}: {
  status: InstallerStatus | null
  error: string | null
  engine: EngineState | null
  onStartAtLogin: (enabled: boolean) => void
  installed: InstalledPanel[]
  busy: boolean
  onUpdate: (build: PanelBuild) => void
  onRemove: (panel: InstalledPanel) => void
  onUninstallApp: () => void
  onGoInstall: () => void
  onRetry: () => void
  onReveal: (target: RevealTarget, index?: number) => void
}): React.JSX.Element {
  return (
    <>
      <EngineSection engine={engine} platform={status?.platform} onStartAtLogin={onStartAtLogin} />
      <Section
        title="Installed panels"
        aside={
          <button type="button" onClick={onRetry} className={buttonClass('quiet')} disabled={busy}>
            <RefreshCw {...ICON} />
            Check again
          </button>
        }
      >
        {error ? (
          <CompatibilityNotice tone="error">{error}</CompatibilityNotice>
        ) : !status ? (
          <p className="text-sm text-ink-3">Checking what’s installed…</p>
        ) : installed.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Asset Library isn't installed in any Adobe app"
            action={
              <button type="button" onClick={onGoInstall} className={buttonClass('secondary')}>
                Go to Install
              </button>
            }
          >
            {status.adobeInstaller
              ? 'Install the panel for Premiere Pro to see it here.'
              : "Adobe's plug-in installer wasn't found, so installed panels can't be listed."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {installed.map((panel) => {
              const bundled = status.available[panel.build]?.version ?? null
              const state = installState([panel], panel.build, bundled)
              const cepFolder =
                panel.build === 'cep' ? status.locations.cepExtensions[0] : undefined
              return (
                <li
                  key={`${panel.build}:${panel.version}`}
                  className="flex flex-wrap items-start gap-3 p-3.5"
                >
                  <Clapperboard {...ICON} className="mt-0.5 text-ink-2" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      Premiere Pro {list(panel.premiere)}
                    </p>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      <dt className="text-ink-3">Method</dt>
                      <dd className="text-ink-2">
                        {PANEL_BUILDS[panel.build].label} (
                        {PANEL_BUILDS[panel.build].badge.toLowerCase()})
                      </dd>
                      <dt className="text-ink-3">Panel version</dt>
                      <dd className="text-ink-2">{panel.version}</dd>
                      <dt className="text-ink-3">Status</dt>
                      <dd
                        className={state === 'update-available' ? 'text-warning' : 'text-success'}
                      >
                        {state === 'update-available'
                          ? `Update available (${bundled})`
                          : 'Up to date'}
                      </dd>
                      <dt className="text-ink-3">Location</dt>
                      <dd className="break-all text-ink-2">
                        {cepFolder ?? 'Managed by Adobe’s plug-in installer'}
                      </dd>
                    </dl>
                  </div>
                  <div className="flex gap-2">
                    {cepFolder && (
                      <button
                        type="button"
                        onClick={() => onReveal('cep-extension', 0)}
                        className={buttonClass('quiet')}
                      >
                        Show
                      </button>
                    )}
                    {state === 'update-available' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUpdate(panel.build)}
                        className={buttonClass('secondary')}
                      >
                        Update
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemove(panel)}
                      className={buttonClass('quiet')}
                      aria-label={`Uninstall ${PANEL_BUILDS[panel.build].label} ${panel.version}`}
                    >
                      <Trash2 {...ICON} />
                      Uninstall
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="After Effects">
        <p className="rounded-lg border border-line bg-panel px-3.5 py-3 text-sm text-ink-2">
          No After Effects panel exists yet, so there&apos;s nothing installed there.
        </p>
      </Section>

      <Section title={`${brand.hubName} app`}>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-3">
          <div className="min-w-0 flex-1 text-sm text-ink-2">
            Removes the panel from Premiere Pro, stops {brand.hubName} from starting at login and
            removes the app. You choose whether to keep your library. Your own asset files are never
            touched.
          </div>
          <button
            type="button"
            onClick={onUninstallApp}
            className={buttonClass('secondary')}
            disabled={busy}
          >
            Uninstall {brand.hubName}…
          </button>
        </div>
      </Section>
    </>
  )
}

function LinkButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Code
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-ink hover:bg-raised"
    >
      <Icon {...ICON} className="text-ink-2" />
      {label}
      <ExternalLink size={14} strokeWidth={1.75} aria-hidden className="ml-auto text-ink-3" />
      <span className="sr-only">(opens in your browser)</span>
    </button>
  )
}

/** The background engine: what it is, that it's on, and the start-at-login switch. */
function EngineSection({
  engine,
  platform,
  onStartAtLogin
}: {
  engine: EngineState | null
  platform: string | undefined
  onStartAtLogin: (enabled: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <Section title="Background engine">
      <div className="rounded-lg border border-line bg-panel px-3.5 py-3 text-sm">
        <p className="flex items-center gap-2 text-ink">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          {engineCopy.runningTitle}
          {engineActivity(engine) && <span className="text-ink-3">({engineActivity(engine)})</span>}
        </p>
        <p className="mt-1 text-ink-2">
          The {brand.productName} panel in Premiere Pro gets your library from {brand.hubName}: it
          finds your files and makes the previews. Keep it running while you edit. It lives in the{' '}
          {trayPlace(platform ?? 'darwin')}; quit it from there.
        </p>
        <div className="mt-3 flex items-start gap-2.5">
          <input
            id={id}
            type="checkbox"
            className="mt-0.5 size-4 accent-brand-500"
            checked={engine?.startAtLogin ?? false}
            disabled={!engine}
            onChange={(event) => onStartAtLogin(event.target.checked)}
          />
          <label htmlFor={id}>
            <span className="text-ink">{engineCopy.startAtLoginLabel}</span>
            <span className="block text-xs text-ink-3">{engineCopy.startAtLoginHint}</span>
          </label>
        </div>
      </div>
    </Section>
  )
}

export function AboutScreen({
  status,
  onLink
}: {
  status: InstallerStatus | null
  onLink: (link: LinkId) => void
}): React.JSX.Element {
  const panelVersion = status ? (status.bundled.uxp ?? status.bundled.cep) : null
  return (
    <>
      <div className="flex items-center gap-4">
        <BrandMark size={56} variant="hub" />
        <div>
          <h1 className="text-lg font-semibold text-ink">{brand.hubName}</h1>
          <p className="text-sm text-ink-2">
            Installs {brand.productName} into Premiere Pro, and runs in the background as the engine
            the panel needs.
          </p>
        </div>
      </div>
      <dl className="mt-5 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-3">App version</dt>
        <dd className="text-ink">{status?.appVersion ?? '—'}</dd>
        <dt className="text-ink-3">Premiere Pro panel</dt>
        <dd className="text-ink">{panelVersion ?? '—'}</dd>
      </dl>
      <p className="mt-5 max-w-xl text-sm text-ink-2">
        Asset Library indexes the folders you choose (transitions, overlays, sound effects, music,
        footage and images) and puts them in a panel inside Premiere Pro, where you preview them and
        place them on the timeline. It works offline, without an account, and never changes your
        files.
      </p>
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-3">
        <BrandMark size={16} />
        {brand.productAttribution}
      </p>
      <Section title="Links">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          <LinkButton icon={Code} label="Source code" onClick={() => onLink('repository')} />
          <LinkButton
            icon={FileText}
            label="Premiere Pro panel guide"
            onClick={() => onLink('panel-guide')}
          />
          <LinkButton icon={Scale} label="License" onClick={() => onLink('license')} />
          <LinkButton icon={Bug} label="Report a problem" onClick={() => onLink('issues')} />
        </div>
      </Section>
    </>
  )
}

export function HelpScreen({ onLink }: { onLink: (link: LinkId) => void }): React.JSX.Element {
  const steps = [
    'On Install, keep Premiere Pro selected.',
    'Leave the recommended method selected: CEP for Premiere Pro 2024 to 2026, UXP for 2027 and later.',
    'Click Install Asset Library and wait for the confirmation.',
    'Restart Premiere Pro, then open the panel: Window → Extensions → Asset Library (CEP) or Window → UXP Plugins → Asset Library (UXP).',
    `Keep ${brand.hubName} running in the background. It's the engine the panel needs; closing its window doesn't stop it.`
  ]
  const problems = [
    {
      title: "The panel isn't in Premiere's Window menu",
      text: 'Quit and reopen Premiere Pro; it only looks for new panels when it starts. Check Manage to see whether the panel is installed.'
    },
    {
      title: '"Adobe\'s plug-in installer wasn\'t found"',
      text: `${brand.hubName} installs the panel through the Creative Cloud app. Install or update Creative Cloud, then click Check again.`
    },
    {
      title: `The panel says ${brand.hubName} isn’t running`,
      text: `Click Start ${brand.hubName} in the panel, or open ${brand.hubName} from Applications (Start menu on Windows). It then keeps running in the background, with its icon in the menu bar or notification area. Turn on "${engineCopy.startAtLoginLabel}" in Manage so it's always ready.`
    },
    {
      title: 'Installing failed',
      text: 'Quit Premiere Pro and try again. If it keeps failing, report the message shown at the bottom of the window.'
    }
  ]
  return (
    <>
      <Section title="Install in five steps">
        <ol className="space-y-2 text-sm text-ink-2">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-raised text-2xs text-ink">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="If something isn't working">
        <div className="divide-y divide-line rounded-lg border border-line bg-panel">
          {problems.map((problem) => (
            <div key={problem.title} className="px-3.5 py-3">
              <p className="text-sm font-medium text-ink">{problem.title}</p>
              <p className="mt-0.5 text-sm text-ink-2">{problem.text}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="More help">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          <LinkButton
            icon={FileText}
            label="Premiere Pro panel guide"
            onClick={() => onLink('panel-guide')}
          />
          <LinkButton icon={Bug} label="Report a problem" onClick={() => onLink('issues')} />
        </div>
      </Section>
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExternalLink, RevealTarget } from '@shared/api'
import { PANEL_BUILDS, type InstalledPanel, type PanelBuild } from '@shared/installer'
import {
  BottomActionBar,
  BrandHeader,
  ConfirmationDialog,
  SidebarNavigation,
  type Screen
} from './components/AppChrome'
import { AboutScreen, HelpScreen, InstallScreen, ManageScreen } from './components/Screens'
import { useInstaller } from './hooks/useInstaller'
import { planInstall, type Choice, type HostApp } from './lib/install-plan'
import { buttonClass } from './lib/ui'

/** What the Uninstall confirmation is about: one installed build, or every installed build. */
type RemovalTarget = { kind: 'one'; panel: InstalledPanel } | { kind: 'all' } | null

const SCREEN_TITLES: Record<Screen, string> = {
  install: 'Install',
  manage: 'Manage',
  about: 'About',
  help: 'Help'
}

/** The installer and manager window. The asset browser itself is the panel inside Premiere. */
export default function App(): React.JSX.Element {
  const installer = useInstaller()
  const { status, error, busy, result } = installer
  const [screen, setScreen] = useState<Screen>('install')
  const [app, setApp] = useState<HostApp>('premiere')
  const [choice, setChoice] = useState<Choice>('recommended')
  const [manualVersion, setManualVersion] = useState<string | null>(null)
  const [removal, setRemoval] = useState<RemovalTarget>(null)
  const main = useRef<HTMLElement>(null)

  const failed = result?.action === 'install' && !result.ok
  const plan = useMemo(
    () => planInstall(status, { app, choice, busy, failed }),
    [status, app, choice, busy, failed]
  )

  // A new screen starts at the top.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [screen])

  const changeChoice = (next: Choice): void => {
    setChoice(next)
    installer.clearResult()
  }
  const reveal = (target: RevealTarget, index?: number): void => {
    void window.assetLibrary.revealLocation(target, index)
  }
  const openLink = (link: ExternalLink): void => {
    void window.assetLibrary.openLink(link)
  }
  const installed = plan.installed
  // Adobe's installer removes a build by name, so every installed version of it goes.
  const removalBuilds: PanelBuild[] =
    removal?.kind === 'one'
      ? [removal.panel.build]
      : [...new Set(installed.map((panel) => panel.build))]
  const removalPanels = installed.filter((panel) => removalBuilds.includes(panel.build))

  const confirmRemoval = async (): Promise<void> => {
    setRemoval(null)
    for (const build of removalBuilds) await installer.remove(build)
  }

  return (
    <div className="flex h-full flex-col">
      <BrandHeader macOS={status?.platform === 'darwin'} onHelp={() => setScreen('help')} />
      <div className="flex min-h-0 flex-1">
        <SidebarNavigation current={screen} onChange={setScreen} />
        <main
          ref={main}
          aria-label={SCREEN_TITLES[screen]}
          className="min-w-0 flex-1 overflow-y-auto px-6 py-5"
        >
          <div className="mx-auto max-w-3xl">
            {screen === 'install' && (
              <InstallScreen
                status={status}
                error={error}
                plan={plan}
                app={app}
                onApp={(next) => {
                  setApp(next)
                  installer.clearResult()
                }}
                choice={choice}
                onChoice={changeChoice}
                manualVersion={manualVersion}
                onManualVersion={setManualVersion}
                onRetry={() => void installer.refresh()}
                onReveal={reveal}
              />
            )}
            {screen === 'manage' && (
              <ManageScreen
                status={status}
                error={error}
                installed={installed}
                busy={busy !== null}
                onUpdate={(build) => void installer.install([build])}
                onRemove={(panel) => setRemoval({ kind: 'one', panel })}
                onUninstallApp={() => void window.assetLibrary.uninstallApp()}
                onGoInstall={() => setScreen('install')}
                onRetry={() => void installer.refresh()}
                onReveal={reveal}
              />
            )}
            {screen === 'about' && <AboutScreen status={status} onLink={openLink} />}
            {screen === 'help' && <HelpScreen onLink={openLink} />}
          </div>
        </main>
      </div>
      <BottomActionBar
        primary={plan.primary}
        onPrimary={() => void installer.install(plan.targets)}
        onClose={() => window.close()}
        message={result ? { ok: result.ok, text: result.message } : null}
        secondary={
          plan.canUninstall ? (
            <button
              type="button"
              onClick={() => setRemoval({ kind: 'all' })}
              className={buttonClass('quiet')}
            >
              Uninstall…
            </button>
          ) : null
        }
      />
      <ConfirmationDialog
        open={removal !== null}
        title={
          removal?.kind === 'one'
            ? `Uninstall the ${PANEL_BUILDS[removal.panel.build].label} panel?`
            : 'Uninstall the Premiere Pro panel?'
        }
        confirmLabel="Uninstall"
        onConfirm={() => void confirmRemoval()}
        onCancel={() => setRemoval(null)}
        extra={
          removal?.kind === 'all' ? (
            <button
              type="button"
              className={buttonClass('quiet')}
              onClick={() => {
                setRemoval(null)
                void window.assetLibrary.uninstallApp()
              }}
            >
              Uninstall the whole app…
            </button>
          ) : null
        }
      >
        <p>This removes:</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          {removalPanels.map((panel) => (
            <li key={`${panel.build}:${panel.version}`}>
              {PANEL_BUILDS[panel.build].label} panel {panel.version}, used by Premiere Pro{' '}
              {panel.premiere.join(', ')}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Other Adobe plugins, your library and your own files stay as they are. Restart Premiere
          Pro afterwards.
        </p>
      </ConfirmationDialog>
    </div>
  )
}

import { isAllowedExternalUrl } from '../security-rules'
import { compareVersions } from './panel-installer'
import type { AvailableUpdate } from './settings'

// One of the app's two network calls (the other is the panel download list, read only when the
// editor opens the Hub window or installs a panel: ./panel-delivery.ts): once a day, when the editor hasn't turned it off, ask
// GitHub for the latest release. Nothing is sent but the request itself.

export const LATEST_RELEASE_URL =
  'https://api.github.com/repos/saxenaxoxo/asset-library/releases/latest'
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_CHECK_TIMEOUT_MS = 10_000
/** How often the engine looks at whether a check is due (it runs for days). */
const DUE_CHECK_MS = 60 * 60 * 1000
/** Waits this long after start-up, so the check never competes with opening the library. */
const FIRST_CHECK_DELAY_MS = 30_000

/** The release in GitHub's "latest release" response, or null if it isn't usable. */
export function parseLatestRelease(data: unknown): AvailableUpdate | null {
  if (!data || typeof data !== 'object') return null
  const release = data as Record<string, unknown>
  if (release['draft'] === true || release['prerelease'] === true) return null
  const tag = release['tag_name']
  const url = release['html_url']
  if (typeof tag !== 'string' || typeof url !== 'string') return null
  const version = tag.trim().replace(/^v/i, '')
  if (!/^\d+(\.\d+){1,3}(-[0-9A-Za-z.-]+)?$/.test(version)) return null
  // Only ever a page the app may open (our own GitHub), whatever the response says.
  if (!isAllowedExternalUrl(url)) return null
  return { version, url }
}

/** `release` if it's newer than the running app, else null. */
export function newerRelease(
  release: AvailableUpdate | null,
  appVersion: string
): AvailableUpdate | null {
  return release && compareVersions(release.version, appVersion) > 0 ? release : null
}

export function updateCheckDue(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS || now < lastCheckAt
}

export interface UpdateCheckerDeps {
  appVersion: string
  fetch(
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal }
  ): Promise<{ ok: boolean; json(): Promise<unknown> }>
  /** The editor's choice (Settings or the panel). */
  enabled(): boolean
  state(): { lastCheckAt: number | null; latest: AvailableUpdate | null }
  record(at: number, latest: AvailableUpdate | null): void
  /** Called when what `available()` returns may have changed. */
  onChange?(): void
  now?(): number
}

export class UpdateChecker {
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private checking: Promise<void> | null = null

  constructor(private readonly deps: UpdateCheckerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** The newer release to tell the editor about, or null (none, or checking is off). */
  available(): AvailableUpdate | null {
    if (!this.deps.enabled()) return null
    return newerRelease(this.deps.state().latest, this.deps.appVersion)
  }

  start(): void {
    this.first = setTimeout(() => void this.checkIfDue(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => void this.checkIfDue(), DUE_CHECK_MS)
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
  }

  /** Asks GitHub, unless checking is off or it already asked in the last day. Never throws. */
  checkIfDue(): Promise<void> {
    if (!this.deps.enabled() || !updateCheckDue(this.deps.state().lastCheckAt, this.now())) {
      return Promise.resolve()
    }
    this.checking ??= this.check().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async check(): Promise<void> {
    const at = this.now()
    let latest = this.deps.state().latest
    try {
      const response = await this.deps.fetch(LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Asset-Library/${this.deps.appVersion}`
        },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)
      })
      if (response.ok) latest = parseLatestRelease(await response.json())
    } catch {
      // Offline or GitHub unreachable: keep what we knew and try again tomorrow.
    }
    // Counted even when it failed, so the app never asks more than once a day.
    this.deps.record(at, newerRelease(latest, this.deps.appVersion))
    this.deps.onChange?.()
  }
}

import { randomUUID } from 'crypto'
import nodePath from 'path'
import { DownloadError, type DownloadErrorCode, type HttpGet } from './http'
import {
  choosePanelSource,
  MAX_MANIFEST_BYTES,
  newestPanel,
  otherProducts,
  parseManifest,
  type PanelManifest,
  type PanelSource
} from './panel-manifest'
import { clearDownloads, downloadVerified, readText } from './panel-download'
import {
  wantedKinds,
  type BundledPanel,
  type PanelFile,
  type PanelInstallResult,
  type PanelKind
} from './panel-installer'

// Gets each panel build from the best place: a verified download when the manifest has a newer
// version than the copy built into the Hub, the built-in copy otherwise (and whenever the
// manifest can't be read). Then installs through PanelInstaller (Adobe's installer).
// The manifest is fetched only when the editor is using the Hub (the window opening, Check again,
// an install from the window or the tray menu), never on a timer and never for the Premiere panel.

/** A manifest this old is fetched again before it's used. */
export const MANIFEST_MAX_AGE_MS = 5 * 60 * 1000
const MANIFEST_TIMEOUT_MS = 15_000

export type CatalogState = 'ok' | 'offline' | 'invalid' | 'not-checked'

export interface CatalogStatus {
  state: CatalogState
  /** Why the manifest couldn't be used, in words; null when it was. */
  message: string | null
  checkedAt: number | null
  manifest: PanelManifest | null
}

export type DeliveryPhase = 'downloading' | 'verifying' | 'installing'

export interface DeliveryProgress {
  phase: DeliveryPhase
  build: PanelKind | null
  version: string | null
  received: number
  total: number
}

export type DeliveryResult = PanelInstallResult & { code?: DownloadErrorCode }

export interface PanelDeliveryInstaller {
  bundled(): BundledPanel[]
  installedVersions(): Promise<(Record<PanelKind, string[]> & { premiere: string[] }) | null>
  install(kinds?: readonly PanelKind[], files?: readonly PanelFile[]): Promise<PanelInstallResult>
}

export interface PanelDeliveryDeps {
  /** The product the Hub installs, as the manifest names it. */
  productId: string
  manifestUrl: string
  http: HttpGet
  isAllowedUrl(url: string): boolean
  isAllowedRedirect(url: string): boolean
  /** Where downloads are written (inside the app's data folder). Emptied at start-up. */
  downloadsDir: string
  installer: PanelDeliveryInstaller
  now?(): number
  /** Lets tests watch the order of steps. */
  onProgress?(progress: DeliveryProgress | null): void
}

/** File names are made here, never taken from the URL. */
export function downloadFileName(build: PanelKind, version: string): string {
  return build === 'cep'
    ? `Asset-Library-Premiere-CEP-${version}.zxp`
    : `Asset-Library-Premiere-${version}.ccx`
}

export class PanelDelivery {
  private catalogStatus: CatalogStatus = {
    state: 'not-checked',
    message: null,
    checkedAt: null,
    manifest: null
  }
  private fetching: Promise<CatalogStatus> | null = null
  /** One delivery at a time; a second one waits its turn and gets its own result. */
  private queue: Promise<unknown> = Promise.resolve()
  private controller: AbortController | null = null
  private current: DeliveryProgress | null = null

  constructor(private readonly deps: PanelDeliveryDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Removes partial downloads left by a crash or a quit mid-download. */
  cleanUp(): Promise<void> {
    return clearDownloads(this.deps.downloadsDir)
  }

  /** The manifest, fetched again when `refresh` is set or it's older than five minutes. */
  catalog(refresh = false): Promise<CatalogStatus> {
    const { checkedAt } = this.catalogStatus
    const fresh = checkedAt !== null && this.now() - checkedAt < MANIFEST_MAX_AGE_MS
    if (fresh && !refresh) return Promise.resolve(this.catalogStatus)
    this.fetching ??= this.fetchCatalog().finally(() => {
      this.fetching = null
    })
    return this.fetching
  }

  private async fetchCatalog(): Promise<CatalogStatus> {
    const { deps } = this
    let next: CatalogStatus
    try {
      const text = await readText(deps.http, deps.manifestUrl, {
        signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
        isAllowedRedirect: deps.isAllowedRedirect,
        maxBytes: MAX_MANIFEST_BYTES
      })
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
      const parsed = parseManifest(data, deps.isAllowedUrl)
      next = parsed.ok
        ? { state: 'ok', message: null, checkedAt: this.now(), manifest: parsed.manifest }
        : { state: 'invalid', message: parsed.reason, checkedAt: this.now(), manifest: null }
      if (parsed.ok && parsed.manifest.skipped > 0) {
        console.warn(`Panel download list: ${parsed.manifest.skipped} entries ignored.`)
      }
    } catch (error) {
      const server = error instanceof DownloadError && error.code === 'server'
      next = {
        state: server ? 'invalid' : 'offline',
        message: server
          ? `The download list couldn't be read. ${(error as Error).message}`
          : "Couldn't reach the download server. You may be offline.",
        checkedAt: this.now(),
        manifest: null
      }
    }
    this.catalogStatus = next
    return next
  }

  /** Where each build would come from now: newer download, else built-in, else nothing. */
  sources(
    catalog: CatalogStatus,
    premiere: readonly string[] = []
  ): Record<PanelKind, PanelSource | null> {
    const bundled = this.deps.installer.bundled()
    const panels = catalog.manifest?.panels ?? []
    const source = (kind: PanelKind): PanelSource | null =>
      choosePanelSource(
        bundled.find((panel) => panel.kind === kind)?.version ?? null,
        newestPanel(panels, this.deps.productId, kind, premiere)
      )
    return { cep: source('cep'), uxp: source('uxp') }
  }

  /** Products in the manifest this Hub doesn't know how to install yet. */
  otherProducts(catalog: CatalogStatus): { id: string; name: string }[] {
    return otherProducts(catalog.manifest?.panels ?? [], this.deps.productId)
  }

  progress(): DeliveryProgress | null {
    return this.current
  }

  /** Stops a download in progress. False when nothing could be cancelled (or it's installing). */
  cancel(): boolean {
    if (!this.controller || this.current?.phase === 'installing') return false
    this.controller.abort()
    return true
  }

  private report(progress: DeliveryProgress | null): void {
    this.current = progress
    this.deps.onProgress?.(progress)
  }

  /** Downloads what's needed, then installs. One at a time; never throws. */
  install(kinds?: readonly PanelKind[]): Promise<DeliveryResult> {
    const job = (): Promise<DeliveryResult> =>
      this.installNow(kinds).finally(() => {
        this.controller = null
        this.report(null)
      })
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async installNow(kinds?: readonly PanelKind[]): Promise<DeliveryResult> {
    const { installer } = this.deps
    const found = await installer.installedVersions().catch(() => null)
    // No Adobe installer or no Premiere: the installer explains (nothing to download for).
    if (!found || found.premiere.length === 0) return installer.install(kinds)
    const wanted = kinds ? [...kinds] : [...wantedKinds(found.premiere)]

    this.controller = new AbortController()
    const { signal } = this.controller
    const catalog = await this.catalog()
    const sources = this.sources(catalog, found.premiere)
    const missing = wanted.filter((kind) => !sources[kind])
    if (missing.length > 0) {
      const what = missing.map((kind) => kind.toUpperCase()).join(' and ')
      return {
        ok: false,
        ...(catalog.state === 'offline' ? { code: 'offline' as const } : {}),
        message:
          catalog.state === 'ok'
            ? `No ${what} panel is available to download yet.`
            : `This copy of the Hub doesn't include the ${what} panel, and it couldn't be downloaded. ${catalog.message ?? ''}`.trim()
      }
    }

    const files: PanelFile[] = []
    const bundled = installer.bundled()
    let fellBack = false
    try {
      for (const kind of wanted) {
        const source = sources[kind]
        if (source?.from !== 'download') continue
        const { panel } = source
        const dest = nodePath.join(
          this.deps.downloadsDir,
          randomUUID(),
          downloadFileName(kind, panel.version)
        )
        this.report({
          phase: 'downloading',
          build: kind,
          version: panel.version,
          received: 0,
          total: panel.size
        })
        try {
          const path = await downloadVerified({
            url: panel.url,
            size: panel.size,
            sha256: panel.sha256,
            dest,
            http: this.deps.http,
            signal,
            isAllowedRedirect: this.deps.isAllowedRedirect,
            onProgress: ({ received, total }) => {
              const phase = received >= total ? 'verifying' : 'downloading'
              this.report({ phase, build: kind, version: panel.version, received, total })
            }
          })
          files.push({ kind, version: panel.version, path })
        } catch (error) {
          // Lost the connection: the copy built into the Hub still works. A file that failed
          // verification or a cancel stops everything instead.
          const offline =
            error instanceof DownloadError &&
            error.code !== 'verification' &&
            error.code !== 'cancelled'
          if (!offline || !bundled.some((b) => b.kind === kind)) throw error
          fellBack = true
        }
      }
      if (signal.aborted) throw new DownloadError('cancelled', 'Download cancelled.')
      this.report({ phase: 'installing', build: null, version: null, received: 0, total: 0 })
      const result = await installer.install(wanted, files)
      if (result.ok && fellBack) {
        return {
          ...result,
          message: `${result.message} The newer version couldn't be downloaded, so the one built into the Hub was installed.`
        }
      }
      return result
    } catch (error) {
      if (error instanceof DownloadError) {
        return { ok: false, code: error.code, message: error.message }
      }
      return { ok: false, message: `Couldn't install the panel: ${(error as Error).message}` }
    } finally {
      // Adobe's installer keeps its own copy; ours (and any partial file) goes.
      await this.cleanUp().catch(() => undefined)
    }
  }
}

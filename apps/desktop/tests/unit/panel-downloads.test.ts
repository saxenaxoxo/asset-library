import { createHash, randomBytes } from 'crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync
} from 'fs'
import http, { type Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DownloadError, MAX_REDIRECTS, type HttpGet } from '../../src/main/engine/http'
import {
  choosePanelSource,
  newestPanel,
  otherProducts,
  parseManifest,
  premiereInRange,
  type ManifestPanel
} from '../../src/main/engine/panel-manifest'
import { downloadVerified } from '../../src/main/engine/panel-download'
import {
  downloadFileName,
  PanelDelivery,
  type PanelDeliveryInstaller
} from '../../src/main/engine/panel-delivery'
import {
  isAllowedDownloadRedirect,
  isAllowedDownloadUrl,
  loopbackTestOrigin,
  PANEL_MANIFEST_URL
} from '../../src/main/security-rules'
import type { PanelFile, PanelKind } from '../../src/main/engine/panel-installer'

const RELEASE = 'https://github.com/saxenaxoxo/asset-library/releases/download/panels/'
const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

function entry(over: Partial<ManifestPanel> = {}): ManifestPanel {
  return {
    product: 'asset-library',
    name: 'Asset Library',
    build: 'cep',
    version: '0.5.0',
    premiere: { min: '22.0', below: null },
    url: `${RELEASE}Asset-Library-Premiere-CEP-0.5.0.zxp`,
    size: 1234,
    sha256: 'a'.repeat(64),
    ...over
  }
}

describe('download allowlist', () => {
  it('allows only HTTPS release assets of our repository', () => {
    expect(isAllowedDownloadUrl(PANEL_MANIFEST_URL)).toBe(true)
    expect(isAllowedDownloadUrl(`${RELEASE}x.zxp`)).toBe(true)
    expect(isAllowedDownloadUrl(`${RELEASE.replace('https', 'http')}x.zxp`)).toBe(false)
    expect(
      isAllowedDownloadUrl('https://github.com/someone-else/asset-library/releases/download/x')
    ).toBe(false)
    expect(
      isAllowedDownloadUrl('https://github.com/saxenaxoxo/asset-library/archive/main.zip')
    ).toBe(false)
    // Dot segments are resolved before the check.
    expect(isAllowedDownloadUrl(`${RELEASE}../../../../evil/releases/download/x`)).toBe(false)
    expect(
      isAllowedDownloadUrl(
        `https://user:pw@github.com/saxenaxoxo/asset-library/releases/download/x`
      )
    ).toBe(false)
    expect(isAllowedDownloadUrl('not a url')).toBe(false)
    expect(isAllowedDownloadUrl('https://downloads.goatedpanels.in/panels.json')).toBe(false)
  })

  it("follows only GitHub's own file hosts", () => {
    expect(isAllowedDownloadRedirect('https://release-assets.githubusercontent.com/x?sig=1')).toBe(
      true
    )
    expect(isAllowedDownloadRedirect('https://objects.githubusercontent.com/x')).toBe(true)
    expect(isAllowedDownloadRedirect('http://objects.githubusercontent.com/x')).toBe(false)
    expect(isAllowedDownloadRedirect('https://objects.githubusercontent.com:8443/x')).toBe(false)
    expect(isAllowedDownloadRedirect('https://evil.example/x')).toBe(false)
  })

  it('accepts a loopback test origin only, and only when given', () => {
    expect(loopbackTestOrigin('http://127.0.0.1:4100/m.json')).toBe('http://127.0.0.1:4100')
    expect(loopbackTestOrigin('http://localhost:4100/m.json')).toBe('http://localhost:4100')
    expect(loopbackTestOrigin('http://192.168.1.2/m.json')).toBeNull()
    expect(loopbackTestOrigin('https://127.0.0.1/m.json')).toBeNull()
    expect(loopbackTestOrigin(undefined)).toBeNull()
    expect(isAllowedDownloadUrl('http://127.0.0.1:4100/x.zxp')).toBe(false)
    expect(isAllowedDownloadUrl('http://127.0.0.1:4100/x.zxp', 'http://127.0.0.1:4100')).toBe(true)
    expect(isAllowedDownloadUrl('http://127.0.0.1:4101/x.zxp', 'http://127.0.0.1:4100')).toBe(false)
  })
})

describe('reading the manifest', () => {
  const allowed = (url: string): boolean => isAllowedDownloadUrl(url)

  it('reads a valid manifest', () => {
    const result = parseManifest({ schema: 1, panels: [entry(), entry({ build: 'uxp' })] }, allowed)
    expect(result).toEqual({
      ok: true,
      manifest: { panels: [entry(), entry({ build: 'uxp' })], skipped: 0 }
    })
  })

  it('refuses unknown formats, and says when the Hub is too old', () => {
    expect(parseManifest(null, allowed)).toMatchObject({ ok: false })
    expect(parseManifest({ panels: [] }, allowed)).toMatchObject({ ok: false })
    expect(parseManifest({ schema: 0, panels: [] }, allowed)).toMatchObject({ ok: false })
    expect(parseManifest({ schema: 2, panels: [] }, allowed)).toEqual({
      ok: false,
      reason: 'The download list needs a newer version of Goated Panels Hub.'
    })
  })

  it('leaves out entries it does not fully understand', () => {
    const result = parseManifest(
      {
        schema: 1,
        panels: [
          entry(),
          entry({ sha256: 'xyz' }),
          entry({ sha256: 'A'.repeat(64) }),
          entry({ size: 0 }),
          entry({ size: 1.5 }),
          entry({ version: '1.0.0-beta' }),
          entry({ url: 'https://evil.example/Asset-Library.zxp' }),
          entry({ url: `${RELEASE.replace('https', 'http')}x.zxp` }),
          { ...entry(), build: 'aex' },
          'nonsense'
        ]
      },
      allowed
    )
    expect(result).toEqual({ ok: true, manifest: { panels: [entry()], skipped: 9 } })
  })
})

describe('choosing where a panel comes from', () => {
  it('checks the Premiere Pro range', () => {
    expect(premiereInRange('26.5.2', { min: '24.0', below: '27.0' })).toBe(true)
    expect(premiereInRange('27.0', { min: '24.0', below: '27.0' })).toBe(false)
    expect(premiereInRange('23.6', { min: '24.0', below: null })).toBe(false)
    expect(premiereInRange('30.1', { min: '25.6', below: null })).toBe(true)
  })

  it('picks the newest entry of the product and build that suits this Premiere', () => {
    const panels = [
      entry({ version: '0.5.0' }),
      entry({ version: '0.6.0', premiere: { min: '27.0', below: null } }),
      entry({ version: '0.9.0', build: 'uxp' }),
      entry({ version: '1.0.0', product: 'spell-checker', name: 'Spell Checker' })
    ]
    expect(newestPanel(panels, 'asset-library', 'cep', ['26.5.2'])?.version).toBe('0.5.0')
    expect(newestPanel(panels, 'asset-library', 'cep', [])?.version).toBe('0.6.0')
    expect(newestPanel(panels, 'asset-library', 'uxp', ['26.5.2'])?.version).toBe('0.9.0')
    expect(newestPanel([], 'asset-library', 'cep', ['26.5.2'])).toBeNull()
    expect(otherProducts(panels, 'asset-library')).toEqual([
      { id: 'spell-checker', name: 'Spell Checker' }
    ])
  })

  it('prefers a newer download, else the built-in copy (also offline)', () => {
    const newer = entry({ version: '0.5.0' })
    expect(choosePanelSource('0.4.1', newer)).toEqual({
      from: 'download',
      version: '0.5.0',
      panel: newer
    })
    expect(choosePanelSource('0.5.0', newer)).toEqual({ from: 'bundled', version: '0.5.0' })
    expect(choosePanelSource('0.6.0', newer)).toEqual({ from: 'bundled', version: '0.6.0' })
    // Offline: no manifest entry.
    expect(choosePanelSource('0.4.1', null)).toEqual({ from: 'bundled', version: '0.4.1' })
    // A download-only product (or a development build).
    expect(choosePanelSource(null, newer)).toMatchObject({ from: 'download' })
    expect(choosePanelSource(null, null)).toBeNull()
  })
})

// A local HTTP server stands in for GitHub; nothing here reaches the network.
type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void
let server: Server
let base = ''
const routes = new Map<string, Route>()

/** GET with node:http, following redirects only when allowed (like the Electron version). */
const nodeHttpGet: HttpGet = async (url, { signal, isAllowedRedirect }) => {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(current, { signal }, resolve)
      req.on('error', reject)
    })
    const location = res.headers.location
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume()
      const next = new URL(location, current).href
      if (!isAllowedRedirect(next)) throw new Error('Refused a redirect')
      current = next
      continue
    }
    const length = res.headers['content-length']
    return {
      status: res.statusCode ?? 0,
      contentLength: length === undefined ? null : Number(length),
      body: res
    }
  }
  throw new Error('Too many redirects')
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const route = routes.get(req.url ?? '')
    if (route) route(req, res)
    else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'panel-downloads-'))
  routes.clear()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const payload = randomBytes(200_000)
const serve =
  (data: Buffer, options: { length?: number | null; slow?: boolean } = {}): Route =>
  (_req, res) => {
    const length = options.length === undefined ? data.length : options.length
    if (length !== null) res.setHeader('Content-Length', String(length))
    if (!options.slow) {
      res.end(data)
      return
    }
    // Trickles the file so a cancel lands mid-download.
    let offset = 0
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer)
      res.write(data.subarray(offset, offset + 8_000))
      offset += 8_000
      if (offset >= data.length) {
        clearInterval(timer)
        res.end()
      }
    }, 20)
  }

const allowLoopback = (url: string): boolean => url.startsWith(base)

function download(
  path: string,
  over: { size?: number; sha256?: string; signal?: AbortSignal; onProgress?: () => void } = {}
): Promise<string> {
  return downloadVerified({
    url: `${base}${path}`,
    size: over.size ?? payload.length,
    sha256: over.sha256 ?? sha(payload),
    dest: join(dir, 'panel.zxp'),
    http: nodeHttpGet,
    signal: over.signal ?? new AbortController().signal,
    isAllowedRedirect: allowLoopback,
    ...(over.onProgress ? { onProgress: over.onProgress } : {})
  })
}

const codeOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof DownloadError ? error.code : `other: ${String(error)}`)
  )

describe('verified downloads', () => {
  it('keeps the file when size and SHA-256 match, with real progress', async () => {
    routes.set('/file', serve(payload))
    const seen: number[] = []
    const path = await downloadVerified({
      url: `${base}/file`,
      size: payload.length,
      sha256: sha(payload),
      dest: join(dir, 'panel.zxp'),
      http: nodeHttpGet,
      signal: new AbortController().signal,
      isAllowedRedirect: allowLoopback,
      onProgress: ({ received, total }) => {
        expect(total).toBe(payload.length)
        seen.push(received)
      }
    })
    expect(readFileSync(path).equals(payload)).toBe(true)
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(payload.length)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(readdirSync(dir)).toEqual(['panel.zxp'])
  })

  it('refuses and deletes a file whose checksum is wrong', async () => {
    routes.set('/file', serve(payload))
    expect(await codeOf(download('/file', { sha256: 'b'.repeat(64) }))).toBe('verification')
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a truncated file (server sent less than promised)', async () => {
    routes.set('/short', serve(payload.subarray(0, 1000), { length: null }))
    expect(await codeOf(download('/short'))).toBe('verification')
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a file of the wrong size before or while reading it', async () => {
    routes.set('/file', serve(payload))
    expect(await codeOf(download('/file', { size: payload.length - 1 }))).toBe('verification')
    routes.set('/unsized', serve(payload, { length: null }))
    expect(await codeOf(download('/unsized', { size: 10 }))).toBe('verification')
    expect(readdirSync(dir)).toEqual([])
  })

  it('cancels mid-download and leaves no partial file', async () => {
    routes.set('/slow', serve(payload, { slow: true }))
    const controller = new AbortController()
    let once = false
    const result = codeOf(
      download('/slow', {
        signal: controller.signal,
        onProgress: () => {
          if (!once && existsSync(join(dir, 'panel.zxp.part'))) {
            once = true
            setTimeout(() => controller.abort(), 30)
          }
        }
      })
    )
    expect(await result).toBe('cancelled')
    expect(readdirSync(dir)).toEqual([])
  })

  it('gives up on a server that never answers', async () => {
    routes.set('/silent', () => {
      // Accepts the connection, never sends headers.
    })
    const started = Date.now()
    const code = await codeOf(
      downloadVerified({
        url: `${base}/silent`,
        size: payload.length,
        sha256: sha(payload),
        dest: join(dir, 'panel.zxp'),
        http: nodeHttpGet,
        signal: new AbortController().signal,
        isAllowedRedirect: allowLoopback,
        stallTimeoutMs: 200
      })
    )
    expect(code).toBe('offline')
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(readdirSync(dir)).toEqual([])
  })

  it("fails cleanly (no crash) when the downloads folder can't be written", async () => {
    if (process.platform === 'win32') return // chmod doesn't make folders read-only there
    routes.set('/file', serve(payload))
    const locked = join(dir, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o555)
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown): void => void uncaught.push(error)
    process.on('uncaughtException', onUncaught)
    try {
      const code = await codeOf(
        downloadVerified({
          url: `${base}/file`,
          size: payload.length,
          sha256: sha(payload),
          dest: join(locked, 'panel.zxp'),
          http: nodeHttpGet,
          signal: new AbortController().signal,
          isAllowedRedirect: allowLoopback
        })
      )
      expect(code).not.toBe('ok')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
      chmodSync(locked, 0o755)
    }
  })

  it('reports server errors and refused redirects', async () => {
    expect(await codeOf(download('/missing'))).toBe('server')
    routes.set('/away', (_req, res) => {
      res.statusCode = 302
      res.setHeader('Location', 'https://evil.example/file')
      res.end()
    })
    expect(await codeOf(download('/away'))).toBe('offline')
    routes.set('/hop', (_req, res) => {
      res.statusCode = 302
      res.setHeader('Location', '/file')
      res.end()
    })
    routes.set('/file', serve(payload))
    expect(await codeOf(download('/hop'))).toBe('ok')
  })
})

describe('downloading and installing a panel', () => {
  const file = randomBytes(50_000)

  function fakeInstaller(
    bundled: { kind: PanelKind; version: string }[]
  ): PanelDeliveryInstaller & {
    calls: { kinds: readonly PanelKind[] | undefined; files: PanelFile[]; hashes: string[] }[]
  } {
    const calls: {
      kinds: readonly PanelKind[] | undefined
      files: PanelFile[]
      hashes: string[]
    }[] = []
    return {
      calls,
      bundled: () => bundled.map((b) => ({ ...b, name: `${b.kind}.file` })),
      installedVersions: async () => ({ premiere: ['26.5.2'], cep: ['0.4.1'], uxp: [] }),
      install: async (kinds, files = []) => {
        // The file must exist and be the verified one at the moment the installer runs.
        calls.push({
          kinds,
          files: [...files],
          hashes: files.map((f) => sha(readFileSync(f.path)))
        })
        return { ok: true, message: 'Installed.', version: files[0]?.version ?? 'bundled' }
      }
    }
  }

  function delivery(
    installer: PanelDeliveryInstaller,
    manifestPath = '/manifest.json'
  ): PanelDelivery {
    return new PanelDelivery({
      productId: 'asset-library',
      manifestUrl: `${base}${manifestPath}`,
      http: nodeHttpGet,
      isAllowedUrl: allowLoopback,
      isAllowedRedirect: allowLoopback,
      downloadsDir: join(dir, 'downloads'),
      installer
    })
  }

  const manifest = (over: Partial<ManifestPanel> = {}): string =>
    JSON.stringify({
      schema: 1,
      panels: [
        entry({
          version: '0.9.0',
          url: `${base}/panel.zxp`,
          size: file.length,
          sha256: sha(file),
          ...over
        })
      ]
    })
  const json =
    (text: string): Route =>
    (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(text)
    }

  it('downloads a newer panel, verifies it, installs it, then cleans up', async () => {
    routes.set('/manifest.json', json(manifest()))
    routes.set('/panel.zxp', serve(file))
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    const phases: string[] = []
    const d = new PanelDelivery({
      productId: 'asset-library',
      manifestUrl: `${base}/manifest.json`,
      http: nodeHttpGet,
      isAllowedUrl: allowLoopback,
      isAllowedRedirect: allowLoopback,
      downloadsDir: join(dir, 'downloads'),
      installer,
      onProgress: (p) => {
        if (p && phases.at(-1) !== p.phase) phases.push(p.phase)
      }
    })
    const catalog = await d.catalog()
    expect(catalog.state).toBe('ok')
    expect(d.sources(catalog, ['26.5.2']).cep).toMatchObject({ from: 'download', version: '0.9.0' })

    const result = await d.install()
    expect(result).toMatchObject({ ok: true })
    expect(phases).toEqual(['downloading', 'verifying', 'installing'])
    expect(installer.calls).toHaveLength(1)
    expect(installer.calls[0]?.kinds).toEqual(['cep'])
    expect(installer.calls[0]?.files[0]).toMatchObject({ kind: 'cep', version: '0.9.0' })
    expect(installer.calls[0]?.files[0]?.path.endsWith(downloadFileName('cep', '0.9.0'))).toBe(true)
    expect(installer.calls[0]?.hashes).toEqual([sha(file)])
    expect(readdirSync(join(dir, 'downloads'))).toEqual([])
    expect(d.progress()).toBeNull()
  })

  it('uses the built-in panel when offline', async () => {
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    // Nothing listens on this path's server route: the manifest 404s → unusable, and a closed
    // port is offline. Both fall back to the built-in copy.
    const d = delivery(installer, '/missing.json')
    expect((await d.catalog()).state).toBe('invalid')
    const closed = new PanelDelivery({
      productId: 'asset-library',
      manifestUrl: 'http://127.0.0.1:9/manifest.json',
      http: nodeHttpGet,
      isAllowedUrl: () => true,
      isAllowedRedirect: () => true,
      downloadsDir: join(dir, 'downloads'),
      installer
    })
    const offline = await closed.catalog()
    expect(offline.state).toBe('offline')
    expect(closed.sources(offline, ['26.5.2']).cep).toEqual({ from: 'bundled', version: '0.4.1' })
    expect(await closed.install()).toMatchObject({ ok: true })
    expect(installer.calls.at(-1)?.files).toEqual([])
  })

  it('keeps the built-in panel when the manifest has nothing newer', async () => {
    routes.set('/manifest.json', json(manifest({ version: '0.4.1' })))
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    const d = delivery(installer)
    expect(d.sources(await d.catalog(), ['26.5.2']).cep).toEqual({
      from: 'bundled',
      version: '0.4.1'
    })
  })

  it('installs nothing when the download fails verification', async () => {
    routes.set('/manifest.json', json(manifest({ sha256: 'c'.repeat(64) })))
    routes.set('/panel.zxp', serve(file))
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    const result = await delivery(installer).install()
    expect(result).toMatchObject({ ok: false, code: 'verification' })
    expect(result.message).toMatch(/checksum/)
    expect(installer.calls).toEqual([])
    expect(readdirSync(join(dir, 'downloads'))).toEqual([])
  })

  it('falls back to the built-in panel when the download itself fails', async () => {
    routes.set('/manifest.json', json(manifest({ url: `${base}/gone.zxp` })))
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    const result = await delivery(installer).install()
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/built into the Hub was installed/)
    expect(installer.calls[0]?.files).toEqual([])
  })

  it('says so when a download-only panel is offline', async () => {
    const installer = fakeInstaller([])
    const d = new PanelDelivery({
      productId: 'asset-library',
      manifestUrl: 'http://127.0.0.1:9/manifest.json',
      http: nodeHttpGet,
      isAllowedUrl: () => true,
      isAllowedRedirect: () => true,
      downloadsDir: join(dir, 'downloads'),
      installer
    })
    const result = await d.install()
    expect(result).toMatchObject({ ok: false, code: 'offline' })
    expect(result.message).toMatch(/couldn't be downloaded/)
    expect(installer.calls).toEqual([])
  })

  it('can be cancelled while downloading', async () => {
    const big = randomBytes(400_000)
    routes.set('/manifest.json', json(manifest({ size: big.length, sha256: sha(big) })))
    routes.set('/panel.zxp', serve(big, { slow: true }))
    const installer = fakeInstaller([{ kind: 'cep', version: '0.4.1' }])
    const d = delivery(installer)
    const running = d.install()
    await expect.poll(() => d.progress()?.received ?? 0).toBeGreaterThan(0)
    expect(d.cancel()).toBe(true)
    expect(await running).toMatchObject({ ok: false, code: 'cancelled' })
    expect(installer.calls).toEqual([])
    expect(readdirSync(join(dir, 'downloads'))).toEqual([])
  })

  it('re-reads the manifest only when asked or after five minutes', async () => {
    let served = 0
    routes.set('/manifest.json', (req, res) => {
      served += 1
      json(manifest())(req, res)
    })
    let now = 1_000_000
    const d = new PanelDelivery({
      productId: 'asset-library',
      manifestUrl: `${base}/manifest.json`,
      http: nodeHttpGet,
      isAllowedUrl: allowLoopback,
      isAllowedRedirect: allowLoopback,
      downloadsDir: join(dir, 'downloads'),
      installer: fakeInstaller([]),
      now: () => now
    })
    await d.catalog()
    await d.catalog()
    expect(served).toBe(1)
    await d.catalog(true)
    expect(served).toBe(2)
    now += 5 * 60 * 1000
    await d.catalog()
    expect(served).toBe(3)
  })
})

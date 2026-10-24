// Pure security checks, kept free of Electron imports so they can be unit-tested.

/** Links the app may open in the user's browser. Everything else is blocked. */
const EXTERNAL_LINK_ALLOWLIST = ['https://github.com/saxenaxoxo/']

/**
 * True when an IPC message comes from our own renderer: the electron-vite dev server in
 * development, or the bundled index.html inside the app package in production.
 */
export function isTrustedSenderUrl(
  senderUrl: string | undefined,
  devServerUrl: string | undefined,
  rendererFileUrlPrefix: string
): boolean {
  if (!senderUrl) return false
  if (devServerUrl) {
    try {
      return new URL(senderUrl).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  return senderUrl.startsWith(rendererFileUrlPrefix)
}

export function isAllowedExternalUrl(url: string): boolean {
  return EXTERNAL_LINK_ALLOWLIST.some((prefix) => url.startsWith(prefix))
}

// Panel downloads. The download list (manifest) and the panel files it names are fetched only
// from these places, over HTTPS. To move downloads to another host (e.g. downloads.goatedpanels.in
// once it exists): change PANEL_MANIFEST_URL and add the host's prefix to DOWNLOAD_URL_PREFIXES.

/** The panel download list, a GitHub Release asset on the rolling "panels" release. */
export const PANEL_MANIFEST_URL =
  'https://github.com/saxenaxoxo/asset-library/releases/download/panels/panels-manifest.json'

/** Where the manifest and the panel files it lists may live. */
const DOWNLOAD_URL_PREFIXES = ['https://github.com/saxenaxoxo/asset-library/releases/download/']

/** GitHub serves release assets by redirecting to its file hosts; only these may be followed. */
const DOWNLOAD_REDIRECT_HOSTS = [
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
]

/**
 * Automated tests serve the manifest from this computer. Only a plain-HTTP loopback origin is
 * accepted (never another host), so this can't open the app to anything on the network.
 */
export function loopbackTestOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:') return null
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null
    return parsed.origin
  } catch {
    return null
  }
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    // No credentials in the URL, ever.
    return parsed.username || parsed.password ? null : parsed
  } catch {
    return null
  }
}

/** True for a manifest or panel-file URL the app may download from. */
export function isAllowedDownloadUrl(url: string, testOrigin: string | null = null): boolean {
  const parsed = parseUrl(url)
  if (!parsed) return false
  if (testOrigin && parsed.origin === testOrigin) return true
  return (
    parsed.protocol === 'https:' &&
    DOWNLOAD_URL_PREFIXES.some((prefix) => parsed.href.startsWith(prefix))
  )
}

/** True for a redirect a download may follow: an allowed URL, or GitHub's own file hosts. */
export function isAllowedDownloadRedirect(url: string, testOrigin: string | null = null): boolean {
  if (isAllowedDownloadUrl(url, testOrigin)) return true
  const parsed = parseUrl(url)
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    DOWNLOAD_REDIRECT_HOSTS.includes(parsed.hostname)
  )
}

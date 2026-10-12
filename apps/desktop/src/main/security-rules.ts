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

import { app, session, shell, type WebContents } from 'electron'
import { isAllowedExternalUrl } from './security-rules'

export { isTrustedSenderUrl } from './security-rules'

function hardenWebContents(contents: WebContents): void {
  // No new windows; allow-listed links open in the default browser instead.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The app is a single page; it never navigates anywhere.
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Applies process-wide security policies. Call once, before creating windows. */
export function applySecurityPolicies(): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))
  // The app needs no camera, microphone, notifications, geolocation, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

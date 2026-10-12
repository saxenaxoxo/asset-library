import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isTrustedSenderUrl } from '../../src/main/security-rules'

const PROD_PREFIX =
  'file:///Applications/Asset%20Library.app/Contents/Resources/app.asar/out/renderer/index.html'

describe('isTrustedSenderUrl', () => {
  it('trusts the bundled renderer in production', () => {
    expect(isTrustedSenderUrl(PROD_PREFIX, undefined, PROD_PREFIX)).toBe(true)
  })

  it('rejects other local files in production', () => {
    expect(isTrustedSenderUrl('file:///Users/me/Downloads/evil.html', undefined, PROD_PREFIX)).toBe(
      false
    )
  })

  it('trusts only the dev server origin in development', () => {
    const dev = 'http://localhost:5173'
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', dev, PROD_PREFIX)).toBe(true)
    expect(isTrustedSenderUrl('http://localhost:9999/', dev, PROD_PREFIX)).toBe(false)
    expect(isTrustedSenderUrl('https://example.com/', dev, PROD_PREFIX)).toBe(false)
  })

  it('rejects missing or malformed sender URLs', () => {
    expect(isTrustedSenderUrl(undefined, undefined, PROD_PREFIX)).toBe(false)
    expect(isTrustedSenderUrl('not a url', 'http://localhost:5173', PROD_PREFIX)).toBe(false)
  })
})

describe('isAllowedExternalUrl', () => {
  it('allows the project GitHub pages only', () => {
    expect(isAllowedExternalUrl('https://github.com/saxenaxoxo/asset-library/issues')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/someone-else/repo')).toBe(false)
    expect(isAllowedExternalUrl('http://github.com/saxenaxoxo/asset-library')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
  })
})

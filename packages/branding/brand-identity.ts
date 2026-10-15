/**
 * Who makes what: the parent brand, the desktop app and the product, as plain text. No logo
 * imports, so the app's main process and the Premiere panel can use it too (like ./brand-links.ts).
 * ./brand-config.ts builds on it for the window. See ./README.md.
 */
export const brandIdentity = {
  /** The parent brand that publishes the panels. */
  brandName: 'Goated Panels',
  /**
   * An attribution string only. The domain is not registered, so nothing may link to it, fetch
   * from it or build a URL out of it until `brandDomainStatus` is 'confirmed'.
   */
  brandDomain: 'goatedpanels.in',
  brandDomainStatus: 'unconfirmed' as 'unconfirmed' | 'confirmed',
  /** Short endorser line, e.g. under a name in a header. */
  brandAttribution: 'by Goated Panels',
  /**
   * The desktop app (installer, manager, background engine). Also its operating-system name:
   * `productName` in apps/desktop/package.json and electron-builder.yml must match (decision I2).
   */
  hubName: 'Goated Panels Hub',
  /**
   * The product: the Premiere Pro panel, its name in Adobe's installer, the Premiere bin and the
   * imports folder. The app was called this before the rename.
   */
  primaryProductName: 'Asset Library',
  /** Secondary attribution for the product, used sparingly (About screens, product listings). */
  productAttribution: 'Asset Library by goatedpanels.in'
} as const

export type BrandIdentity = typeof brandIdentity

/**
 * Single source of truth for the brand: Goated Panels (parent brand), Goated Panels Hub (the
 * desktop window) and Asset Library (the product). Names live in ./brand-identity.ts.
 *
 * To rebrand: replace the files in ./assets (keep the same names) and edit the values below.
 * No component references logo files or brand colours directly — they all read from here.
 * See ./README.md.
 */
import logoMarkUrl from './assets/logo-mark.svg'
import hubMarkUrl from './assets/goated-panels-mark.svg'
import appIconUrl from './assets/app-icon.svg'
import { brandIdentity, type BrandIdentity } from './brand-identity'
import { brandLinks } from './brand-links'

export type BrandRampStop = '200' | '300' | '400' | '500' | '600' | '700'

export interface BrandConfig extends BrandIdentity {
  /** The product's name (same as `primaryProductName`). */
  productName: string
  /** Endorser line shown under a name (same as `brandAttribution`). */
  attribution: string
  tagline: string
  /** Shown when an image asset fails to load: the product's and the hub's. */
  monogram: string
  hubMonogram: string
  assets: {
    /** The product's compact square mark (Asset Library). */
    logoMark: string
    /** The parent brand's compact square mark, used for the hub's header and About screen. */
    hubMark: string
    /** Full app icon artwork (source for build/icon.png via `pnpm icons`). */
    appIcon: string
  }
  colors: {
    /** Accent ramp; `500` is the primary accent. */
    accent: Record<BrandRampStop, string>
    /** Text/icon colour used on top of the accent. */
    onAccent: string
    /** Accent-tinted surface for selected rows and highlights. */
    accentSurface: string
  }
  links: {
    repository: string
    issues: string
  }
}

export const brand: BrandConfig = {
  ...brandIdentity,
  productName: brandIdentity.primaryProductName,
  attribution: brandIdentity.brandAttribution,
  tagline: 'Every asset you own, one search away.',
  monogram: 'AL',
  hubMonogram: 'GP',
  assets: {
    logoMark: logoMarkUrl,
    hubMark: hubMarkUrl,
    appIcon: appIconUrl
  },
  colors: {
    accent: {
      '200': '#DDD6FE',
      '300': '#C4B5FD',
      '400': '#A78BFA',
      '500': '#8B5CF6',
      '600': '#7C3AED',
      '700': '#6D28D9'
    },
    onAccent: '#FFFFFF',
    accentSurface: '#1C1A24'
  },
  links: brandLinks
}

/** CSS custom properties derived from the brand, applied once at renderer start-up. */
export function brandCssVariables(config: BrandConfig = brand): Record<string, string> {
  const vars: Record<string, string> = {
    '--brand-on-accent': config.colors.onAccent,
    '--brand-accent-surface': config.colors.accentSurface
  }
  for (const [stop, value] of Object.entries(config.colors.accent)) {
    vars[`--brand-${stop}`] = value
  }
  return vars
}

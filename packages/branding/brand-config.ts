/**
 * Single source of truth for Asset Library's brand.
 *
 * To rebrand: replace the files in ./assets (keep the same names) and edit the values below.
 * No component references logo files or brand colours directly — they all read from here.
 * See ./README.md.
 */
import logoMarkUrl from './assets/logo-mark.svg'
import appIconUrl from './assets/app-icon.svg'

export type BrandRampStop = '200' | '300' | '400' | '500' | '600' | '700'

export interface BrandConfig {
  productName: string
  parentBrand: string
  attribution: string
  tagline: string
  /** Shown when an image asset fails to load. */
  monogram: string
  assets: {
    /** Compact square mark used in the sidebar, about box and empty states. */
    logoMark: string
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
  productName: 'Asset Library',
  parentBrand: 'Saxenas Creation',
  attribution: 'by Saxenas Creation',
  tagline: 'Every asset you own, one search away.',
  monogram: 'AL',
  assets: {
    logoMark: logoMarkUrl,
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
  links: {
    repository: 'https://github.com/saxenaxoxo/asset-library',
    issues: 'https://github.com/saxenaxoxo/asset-library/issues'
  }
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

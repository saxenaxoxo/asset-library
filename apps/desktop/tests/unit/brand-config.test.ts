import { describe, expect, it } from 'vitest'
import { brand, brandCssVariables, type BrandRampStop } from '@brand/brand-config'

const HEX = /^#[0-9A-F]{6}$/i
const STOPS: BrandRampStop[] = ['200', '300', '400', '500', '600', '700']

describe('brand config', () => {
  it('names the product, the hub and their parent brand', () => {
    expect(brand.productName).toBe('Asset Library')
    expect(brand.primaryProductName).toBe(brand.productName)
    expect(brand.brandName).toBe('Goated Panels')
    expect(brand.hubName).toBe('Goated Panels Hub')
    expect(brand.attribution).toContain(brand.brandName)
    expect(brand.productAttribution).toContain(brand.productName)
    expect(brand.monogram.length).toBeGreaterThan(0)
    expect(brand.hubMonogram.length).toBeGreaterThan(0)
  })

  it('treats the unregistered domain as text, never as a link', () => {
    expect(brand.brandDomainStatus).toBe('unconfirmed')
    expect(brand.productAttribution).toContain(brand.brandDomain)
    for (const url of Object.values(brand.links)) {
      expect(url).not.toContain(brand.brandDomain)
    }
  })

  it('defines every accent stop as a hex colour', () => {
    for (const stop of STOPS) {
      expect(brand.colors.accent[stop]).toMatch(HEX)
    }
    expect(brand.colors.onAccent).toMatch(HEX)
    expect(brand.colors.accentSurface).toMatch(HEX)
  })

  it('points at bundled logo assets, never a remote URL', () => {
    for (const url of Object.values(brand.assets)) {
      expect(url).toBeTruthy()
      expect(url).not.toMatch(/^https?:\/\//)
    }
  })

  it('exposes one CSS variable per accent stop plus the surface colours', () => {
    const vars = brandCssVariables()
    for (const stop of STOPS) {
      expect(vars[`--brand-${stop}`]).toBe(brand.colors.accent[stop])
    }
    expect(vars['--brand-on-accent']).toBe(brand.colors.onAccent)
    expect(vars['--brand-accent-surface']).toBe(brand.colors.accentSurface)
  })

  it('follows a replaced config without code changes', () => {
    const custom = {
      ...brand,
      colors: { ...brand.colors, accent: { ...brand.colors.accent, '500': '#123456' } }
    }
    expect(brandCssVariables(custom)['--brand-500']).toBe('#123456')
  })
})

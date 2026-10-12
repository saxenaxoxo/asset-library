import { describe, expect, it } from 'vitest'
import { allowedLink } from '../src/host-cep/platform'
import { literal } from '../src/host-cep/premiere'

describe('CEP host layer', () => {
  it('writes ExtendScript literals that survive line terminators and non-ASCII', () => {
    const tricky = 'Düsseldorf "); evil() // '
    const text = literal(tricky)
    expect(text).not.toMatch(/[\u007f-￿]/)
    expect(text).toBe('"D\\u00fcsseldorf\\u2028\\"); evil() //\\u2029"')
    expect(JSON.parse(text)).toBe(tricky)
    expect(literal({ path: '/a/b.mov', mogrt: false, n: 2 })).toBe(
      '{"path":"/a/b.mov","mogrt":false,"n":2}'
    )
  })

  it('only opens web pages and the engine start link', () => {
    expect(allowedLink('https://github.com/saxenaxoxo/asset-library/releases')).toBe(true)
    expect(allowedLink('assetlibrary://start')).toBe(true)
    expect(allowedLink('http://example.com')).toBe(false)
    expect(allowedLink('file:///etc/passwd')).toBe(false)
    expect(allowedLink('/Applications/Calculator.app')).toBe(false)
    expect(allowedLink('assetlibrary://open?x=1')).toBe(false)
  })
})

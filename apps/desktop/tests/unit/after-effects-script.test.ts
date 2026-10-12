import { describe, expect, it } from 'vitest'
import { afterEffectsScript, jsString } from '../../src/main/hosts/after-effects-script'

describe('afterEffectsScript', () => {
  it('embeds the path as a safe string literal', () => {
    const script = afterEffectsScript({
      path: '/Volumes/SSD/My "Best" Glow\u2028.mov',
      addToComp: false
    })
    expect(script).toContain('new File("/Volumes/SSD/My \\"Best\\" Glow\\u2028.mov")')
    // The literal parses back to the exact path: no way to break out of the string.
    expect(JSON.parse(jsString('a"); alert("x'))).toBe('a"); alert("x')
  })

  it('only adds a layer when asked', () => {
    expect(afterEffectsScript({ path: '/a.mov', addToComp: true })).toContain(
      'comp.layers.add(item)'
    )
    expect(afterEffectsScript({ path: '/a.mov', addToComp: false })).not.toContain(
      'comp.layers.add'
    )
  })

  it('handles presets and projects, inside one undo group', () => {
    const script = afterEffectsScript({ path: '/p.ffx', addToComp: false })
    expect(script).toContain('applyPreset(file)')
    expect(script).toContain('ImportAsType.PROJECT')
    expect(script.indexOf('beginUndoGroup')).toBeLessThan(script.indexOf('endUndoGroup'))
  })

  it('is syntactically valid JavaScript', () => {
    for (const addToComp of [true, false]) {
      expect(() => new Function(afterEffectsScript({ path: '/x.mov', addToComp }))).not.toThrow()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import {
  afterEffectsScript,
  extendScriptPath,
  jsString
} from '../../src/main/hosts/after-effects-script'

vi.mock('electron', () => ({}))
const { runScriptFileArgs, sortAfterEffectsFolders } =
  await import('../../src/main/hosts/after-effects')

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

describe('extendScriptPath', () => {
  it('escapes percent signs so File() does not decode them', () => {
    expect(extendScriptPath('/SFX/50% off.wav')).toBe('/SFX/50%25 off.wav')
    expect(extendScriptPath('/SFX/%20.wav')).toBe('/SFX/%2520.wav')
    expect(afterEffectsScript({ path: '/a 100%.mov', addToComp: false })).toContain(
      'new File("/a 100%25.mov")'
    )
  })
})

describe('sortAfterEffectsFolders', () => {
  it('puts the newest release first, older CC names and betas after it', () => {
    expect(
      sortAfterEffectsFolders([
        'Adobe After Effects CC 2019',
        'Adobe After Effects (Beta)',
        'Adobe After Effects 2026',
        'Adobe After Effects 2025',
        'Adobe Premiere Pro 2026'
      ])
    ).toEqual([
      'Adobe After Effects 2026',
      'Adobe After Effects 2025',
      'Adobe After Effects CC 2019',
      'Adobe After Effects (Beta)'
    ])
  })
})

describe('runScriptFileArgs', () => {
  it("uses After Effects' raw DoScriptFile event and passes values as argv", () => {
    const args = runScriptFileArgs('Adobe After Effects 2026', '/tmp/a "b".jsx')
    const source = args.filter((_, i) => args[i - 1] === '-e').join('\n')
    // The plain word "DoScriptFile" fails (-1708) when the app is named at run time.
    expect(source).toContain('«event miscfile»')
    expect(source).not.toContain('DoScriptFile')
    expect(source).not.toContain('/tmp')
    expect(args.slice(-2)).toEqual(['Adobe After Effects 2026', '/tmp/a "b".jsx'])
  })
})

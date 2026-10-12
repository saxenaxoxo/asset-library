import { describe, expect, it } from 'vitest'
import {
  dragContentType,
  fileUri,
  fileUrl,
  homeFromDataFolder,
  hostMajor,
  samePath
} from '../src/paths'

describe('file URIs', () => {
  it('percent-encodes spaces and handles Windows drive paths', () => {
    expect(fileUri('/Volumes/SSD/Light Leaks/leak 01.mov')).toBe(
      'file:///Volumes/SSD/Light%20Leaks/leak%2001.mov'
    )
    expect(fileUri('D:\\Assets\\Whoosh.wav')).toBe('file:///D:/Assets/Whoosh.wav')
    expect(fileUrl('/Users/ed/a b.png')).toBe('file:/Users/ed/a%20b.png')
  })

  it('encodes characters that would end the path (# ? %)', () => {
    expect(fileUri('/Volumes/SSD/Pack #2/hit?.wav')).toBe(
      'file:///Volumes/SSD/Pack%20%232/hit%3F.wav'
    )
    expect(fileUri('/Users/ed/100% Grain.mov')).toBe('file:///Users/ed/100%25%20Grain.mov')
    expect(fileUrl('/Users/ed/#1.png')).toBe('file:/Users/ed/%231.png')
    expect(fileUri('/Users/ed/Café.mov')).toBe('file:///Users/ed/Caf%C3%A9.mov')
  })

  it('handles Windows drive letters and network shares', () => {
    expect(fileUri('C:\\Users\\Ed\\My Clips\\a#b.mov')).toBe(
      'file:///C:/Users/Ed/My%20Clips/a%23b.mov'
    )
    expect(fileUri('C:/Assets/x.mov')).toBe('file:///C:/Assets/x.mov')
    expect(fileUrl('D:\\Assets\\x.png')).toBe('file:/D:/Assets/x.png')
    expect(fileUri('\\\\server\\share\\Assets\\x y.mov')).toBe(
      'file://server/share/Assets/x%20y.mov'
    )
    expect(fileUrl('\\\\nas\\media\\x.png')).toBe('file://nas/media/x.png')
  })
})

describe('homeFromDataFolder', () => {
  it('finds the home folder on macOS and Windows', () => {
    expect(
      homeFromDataFolder('/Users/ed/Library/Application Support/Adobe/UXP/PluginsStorage/PPRO/26/x')
    ).toBe('/Users/ed')
    expect(homeFromDataFolder('C:\\Users\\Ed\\AppData\\Roaming\\Adobe\\UXP\\PluginsStorage')).toBe(
      'C:\\Users\\Ed'
    )
    expect(homeFromDataFolder('/tmp/somewhere')).toBeNull()
  })
})

describe('drag support', () => {
  it('knows which files Premiere accepts by drag', () => {
    expect(dragContentType('Glow.MOV')).toBe('video/quicktime')
    expect(dragContentType('hit.wav')).toBe('audio/wav')
    expect(dragContentType('title.mogrt')).toBeNull()
    expect(dragContentType('noext')).toBeNull()
  })

  it('reads the host major version', () => {
    expect(hostMajor('26.5.2')).toBe(26)
    expect(hostMajor('27.0.0')).toBe(27)
    expect(hostMajor('')).toBe(0)
  })
})

describe('samePath', () => {
  it('is exact on macOS and case/slash-insensitive on Windows', () => {
    expect(samePath('/a/B.mov', '/a/b.mov', false)).toBe(false)
    expect(samePath('C:\\A\\b.mov', 'c:/a/B.MOV', true)).toBe(true)
  })

  it('treats composed and decomposed accents as the same path', () => {
    const composed = '/Volumes/SSD/Caf\u00e9.mov'
    const decomposed = '/Volumes/SSD/Cafe\u0301.mov'
    expect(samePath(composed, decomposed, false)).toBe(true)
    expect(samePath('C:\\Caf\u00e9.MOV', 'c:/cafe\u0301.mov', true)).toBe(true)
  })
})

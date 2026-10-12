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
})

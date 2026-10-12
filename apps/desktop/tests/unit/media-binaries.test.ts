import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { mediaBinaries } from '../../src/main/media/binaries'

describe('mediaBinaries', () => {
  it('uses the bundled resources folder in packaged apps', () => {
    const paths = mediaBinaries({
      packaged: true,
      resourcesPath: '/Applications/Asset Library.app/Contents/Resources',
      appPath: '/ignored',
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(paths.ffprobe).toBe(
      join('/Applications/Asset Library.app/Contents/Resources', 'ffmpeg', 'ffprobe')
    )
  })

  it('uses the per-platform build output in development', () => {
    const paths = mediaBinaries({
      packaged: false,
      resourcesPath: '/ignored',
      appPath: '/repo',
      platform: 'darwin',
      arch: 'x64'
    })
    expect(paths.ffmpeg).toBe(join('/repo', 'resources', 'ffmpeg', 'darwin-x64', 'ffmpeg'))
  })

  it('adds .exe on Windows', () => {
    const paths = mediaBinaries({
      packaged: true,
      resourcesPath: 'C:\\Program Files\\Asset Library\\resources',
      appPath: '',
      platform: 'win32',
      arch: 'x64'
    })
    expect(paths.ffmpeg.endsWith('ffmpeg.exe')).toBe(true)
    expect(paths.ffprobe.endsWith('ffprobe.exe')).toBe(true)
  })
})

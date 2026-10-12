import { join } from 'path'

export interface MediaBinaries {
  ffmpeg: string
  ffprobe: string
}

/**
 * Where the bundled LGPL FFmpeg executables live.
 * Packaged: <resources>/ffmpeg/ (copied by electron-builder `extraResources`).
 * Development: <repo>/resources/ffmpeg/<platform>-<arch>/ (built by scripts/ffmpeg).
 */
export function mediaBinaries(options: {
  packaged: boolean
  resourcesPath: string
  appPath: string
  platform: NodeJS.Platform
  arch: string
}): MediaBinaries {
  const dir = options.packaged
    ? join(options.resourcesPath, 'ffmpeg')
    : join(options.appPath, 'resources', 'ffmpeg', `${options.platform}-${options.arch}`)
  const ext = options.platform === 'win32' ? '.exe' : ''
  return { ffmpeg: join(dir, `ffmpeg${ext}`), ffprobe: join(dir, `ffprobe${ext}`) }
}

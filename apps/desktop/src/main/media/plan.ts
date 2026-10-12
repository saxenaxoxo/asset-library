import type { AssetKind } from '@shared/media-types'

/** One generated file. `args` are passed to ffmpeg as an argument array (never a shell). */
export interface MediaJob {
  output: 'thumb' | 'sprite' | 'preview' | 'wave'
  file: string
  args: string[]
}

export interface MediaPlanInput {
  kind: AssetKind
  /** Absolute path of the original (read only, never written). */
  input: string
  /** File-name prefix inside the cache folder, e.g. "<asset id>-<content key>". */
  base: string
  hasAlpha: boolean | null
  durationMs: number | null
  width: number | null
  height: number | null
  platform: NodeJS.Platform
}

export const THUMB_WIDTH = 480
export const SPRITE_FRAMES = 10
export const SPRITE_FRAME_WIDTH = 240
export const PREVIEW_WIDTH = 640
export const PREVIEW_MAX_SECONDS = 20
export const AUDIO_PREVIEW_MAX_SECONDS = 120
/** Background behind transparent clips in preview videos (matches the UI's raised surface). */
const PREVIEW_MATTE = '0x26262f'

/** Hardware H.264 encoders that ship with the OS, so the LGPL FFmpeg build can use them. */
export function h264Encoder(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return 'h264_videotoolbox'
  if (platform === 'win32') return 'h264_mf'
  return null
}

const COMMON = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2']

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Which files to generate for an asset, and how. Transparent media keeps its alpha in
 * thumbnails and sprites (PNG); preview videos sit on a neutral matte because H.264 has no alpha.
 */
export function mediaPlan(asset: MediaPlanInput): MediaJob[] {
  const { kind, input, base } = asset
  const alpha = asset.hasAlpha === true
  const stillExt = alpha ? 'png' : 'jpg'
  const stillCodec = alpha ? ['-c:v', 'png', '-pix_fmt', 'rgba'] : ['-q:v', '4']
  const durationS = asset.durationMs ? asset.durationMs / 1000 : null
  const jobs: MediaJob[] = []

  if (kind === 'image') {
    const file = `${base}.thumb.${stillExt}`
    jobs.push({
      output: 'thumb',
      file,
      args: [
        ...COMMON,
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${THUMB_WIDTH},iw)':-2:flags=bicubic`,
        ...stillCodec,
        file
      ]
    })
  }

  if (kind === 'video') {
    const seek = durationS ? Math.min(3, Math.max(0, durationS * 0.1)) : 0
    const thumb = `${base}.thumb.${stillExt}`
    jobs.push({
      output: 'thumb',
      file: thumb,
      args: [
        ...COMMON,
        '-ss',
        seek.toFixed(3),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMB_WIDTH}:-2:flags=bicubic`,
        ...stillCodec,
        thumb
      ]
    })

    if (durationS && durationS > 0.2) {
      const sprite = `${base}.sprite.${stillExt}`
      const rate = (SPRITE_FRAMES / durationS).toFixed(6)
      jobs.push({
        output: 'sprite',
        file: sprite,
        args: [
          ...COMMON,
          '-i',
          input,
          '-an',
          '-vf',
          `fps=${rate},scale=${SPRITE_FRAME_WIDTH}:-2:flags=bicubic,tile=${SPRITE_FRAMES}x1`,
          '-frames:v',
          '1',
          ...stillCodec,
          sprite
        ]
      })
    }

    const encoder = h264Encoder(asset.platform)
    if (encoder && asset.width && asset.height) {
      const width = even(Math.min(PREVIEW_WIDTH, asset.width))
      const height = even((width * asset.height) / asset.width)
      const preview = `${base}.preview.mp4`
      const video = alpha
        ? [
            '-filter_complex',
            `color=c=${PREVIEW_MATTE}:s=${width}x${height}[bg];` +
              `[0:v]scale=${width}:${height},format=rgba[fg];` +
              `[bg][fg]overlay=shortest=1,format=yuv420p[v]`,
            '-map',
            '[v]',
            '-map',
            '0:a?'
          ]
        : ['-vf', `scale=${width}:${height},format=yuv420p`]
      jobs.push({
        output: 'preview',
        file: preview,
        args: [
          ...COMMON,
          '-i',
          input,
          '-t',
          String(PREVIEW_MAX_SECONDS),
          ...video,
          '-c:v',
          encoder,
          '-b:v',
          '2M',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ac',
          '2',
          '-movflags',
          '+faststart',
          preview
        ]
      })
    }
  }

  if (kind === 'audio') {
    const wave = `${base}.wave.png`
    jobs.push({
      output: 'wave',
      file: wave,
      args: [
        ...COMMON,
        '-i',
        input,
        '-filter_complex',
        'aformat=channel_layouts=mono,showwavespic=s=960x160:colors=0xA78BFA',
        '-frames:v',
        '1',
        wave
      ]
    })
    const preview = `${base}.preview.m4a`
    jobs.push({
      output: 'preview',
      file: preview,
      args: [
        ...COMMON,
        '-i',
        input,
        '-t',
        String(AUDIO_PREVIEW_MAX_SECONDS),
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        preview
      ]
    })
  }

  return jobs
}

import type { ProbeResult } from '../library/types'

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  pix_fmt?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  sample_rate?: string
  duration?: string
  tags?: Record<string, string>
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; format_name?: string }
}

/** Arguments for `ffprobe` that print what parseProbe needs, as JSON. */
export const PROBE_ARGS = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']

/** Pixel formats that carry an alpha channel. */
const ALPHA_PIX_FMT = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya[0-9])|a64/

function rate(value: string | undefined): number | null {
  if (!value) return null
  const [num, den] = value.split('/').map(Number)
  if (!num || !den) return null
  const fps = num / den
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null
}

function seconds(value: string | undefined): number | null {
  if (!value) return null
  const s = Number(value)
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null
}

/**
 * Turns ffprobe JSON into the fields we store. Anything ffprobe doesn't report stays null:
 * metadata is never invented. Still images report no duration or frame rate.
 */
export function parseProbe(json: string, kind: 'video' | 'audio' | 'image'): ProbeResult {
  const output = JSON.parse(json) as FfprobeOutput
  const streams = output.streams ?? []
  // Embedded cover art in audio files shows up as a video stream; ignore it for audio.
  const video = kind === 'audio' ? undefined : streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const isStill = kind === 'image'
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationMs: isStill
      ? null
      : (seconds(output.format?.duration) ?? seconds(video?.duration ?? audio?.duration)),
    fps: isStill || !video ? null : (rate(video.avg_frame_rate) ?? rate(video.r_frame_rate)),
    codec: (kind === 'audio' ? audio?.codec_name : video?.codec_name) ?? null,
    hasAlpha: video?.pix_fmt ? ALPHA_PIX_FMT.test(video.pix_fmt) : null,
    channels: audio?.channels ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) || null : null
  }
}

import { describe, expect, it } from 'vitest'
import { parseProbe } from '../../src/main/media/probe'

const json = (value: unknown): string => JSON.stringify(value)

describe('parseProbe', () => {
  it('reads a ProRes 4444 overlay with alpha', () => {
    const result = parseProbe(
      json({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'prores',
            profile: '4444',
            width: 3840,
            height: 2160,
            pix_fmt: 'yuva444p12le',
            avg_frame_rate: '30000/1001'
          }
        ],
        format: { duration: '4.004000' }
      }),
      'video'
    )
    expect(result).toEqual({
      width: 3840,
      height: 2160,
      durationMs: 4004,
      fps: 29.97,
      codec: 'prores',
      hasAlpha: true,
      channels: null,
      sampleRate: null
    })
  })

  it('reads an H.264 clip with audio and no alpha', () => {
    const result = parseProbe(
      json({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            pix_fmt: 'yuv420p',
            avg_frame_rate: '25/1'
          },
          { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }
        ],
        format: { duration: '10.5' }
      }),
      'video'
    )
    expect(result).toMatchObject({
      hasAlpha: false,
      fps: 25,
      durationMs: 10500,
      channels: 2,
      sampleRate: 48000
    })
  })

  it('reads audio and ignores embedded cover art', () => {
    const result = parseProbe(
      json({
        streams: [
          { codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '44100' },
          { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, pix_fmt: 'yuvj420p' }
        ],
        format: { duration: '182.3' }
      }),
      'audio'
    )
    expect(result).toEqual({
      width: null,
      height: null,
      durationMs: 182300,
      fps: null,
      codec: 'mp3',
      hasAlpha: null,
      channels: 2,
      sampleRate: 44100
    })
  })

  it('gives stills dimensions and alpha but no duration or frame rate', () => {
    const result = parseProbe(
      json({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'png',
            width: 1000,
            height: 500,
            pix_fmt: 'rgba',
            avg_frame_rate: '25/1'
          }
        ],
        format: { duration: '0.04' }
      }),
      'image'
    )
    expect(result).toMatchObject({
      width: 1000,
      height: 500,
      hasAlpha: true,
      durationMs: null,
      fps: null
    })
  })

  it('leaves unknown values null instead of guessing', () => {
    expect(parseProbe(json({}), 'video')).toEqual({
      width: null,
      height: null,
      durationMs: null,
      fps: null,
      codec: null,
      hasAlpha: null,
      channels: null,
      sampleRate: null
    })
    expect(
      parseProbe(json({ streams: [{ codec_type: 'video', avg_frame_rate: '0/0' }] }), 'video').fps
    ).toBeNull()
  })
})

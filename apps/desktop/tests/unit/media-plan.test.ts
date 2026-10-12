import { describe, expect, it } from 'vitest'
import { h264Encoder, mediaPlan, type MediaPlanInput } from '../../src/main/media/plan'

const base: MediaPlanInput = {
  kind: 'video',
  input: '/Volumes/SSD/Overlays/Glow.mov',
  base: 'id-key',
  hasAlpha: false,
  durationMs: 4000,
  width: 3840,
  height: 2160,
  platform: 'darwin'
}

const outputs = (input: MediaPlanInput): string[] => mediaPlan(input).map((job) => job.output)

describe('mediaPlan', () => {
  it('makes a thumbnail, scrub strip and H.264 preview for video', () => {
    const jobs = mediaPlan(base)
    expect(jobs.map((j) => j.output)).toEqual(['thumb', 'sprite', 'preview'])
    expect(jobs.map((j) => j.file)).toEqual([
      'id-key.thumb.jpg',
      'id-key.sprite.jpg',
      'id-key.preview.mp4'
    ])
    const preview = jobs[2]!.args
    expect(preview).toContain('h264_videotoolbox')
    expect(preview.join(' ')).toContain('scale=640:360')
  })

  it('keeps alpha in stills and puts previews on a matte', () => {
    const jobs = mediaPlan({ ...base, hasAlpha: true })
    expect(jobs[0]!.file).toBe('id-key.thumb.png')
    expect(jobs[0]!.args).toContain('rgba')
    expect(jobs[1]!.file).toBe('id-key.sprite.png')
    expect(jobs[2]!.args.join(' ')).toContain('overlay=shortest=1')
  })

  it('reads the original only as input and writes bare file names inside the cache', () => {
    for (const kind of ['video', 'audio', 'image'] as const) {
      for (const job of mediaPlan({ ...base, kind })) {
        expect(job.args[job.args.length - 1]).toBe(job.file)
        expect(job.file).not.toMatch(/[\\/]/)
        expect(job.args.filter((a) => a === base.input)).toHaveLength(1)
        expect(job.args[job.args.indexOf(base.input) - 1]).toBe('-i')
      }
    }
  })

  it('makes a waveform and an AAC preview for audio', () => {
    expect(outputs({ ...base, kind: 'audio' })).toEqual(['wave', 'preview'])
  })

  it('only thumbnails images', () => {
    expect(outputs({ ...base, kind: 'image' })).toEqual(['thumb'])
  })

  it('skips previews when size is unknown and scrubbing when the clip is a single frame', () => {
    expect(outputs({ ...base, width: null })).toEqual(['thumb', 'sprite'])
    expect(outputs({ ...base, durationMs: 40 })).toEqual(['thumb', 'preview'])
  })

  it('uses the encoder that ships with each OS', () => {
    expect(h264Encoder('darwin')).toBe('h264_videotoolbox')
    expect(h264Encoder('win32')).toBe('h264_mf')
    expect(outputs({ ...base, platform: 'linux' })).toEqual(['thumb', 'sprite'])
  })

  it('keeps preview dimensions even (required by H.264)', () => {
    const args = mediaPlan({ ...base, width: 1081, height: 1921 })[2]!.args.join(' ')
    expect(args).toMatch(/scale=(\d*[02468]):(\d*[02468])/)
  })

  it('seeks to each scrub frame on long clips instead of decoding the whole file', () => {
    const sprite = mediaPlan({ ...base, durationMs: 3_600_000 }).find((j) => j.output === 'sprite')!
    const seeks = sprite.args.filter((_, i) => sprite.args[i - 1] === '-ss')
    expect(seeks).toHaveLength(10)
    expect(Number(seeks[0])).toBeCloseTo(180)
    expect(Number(seeks[9])).toBeCloseTo(3420)
    expect(sprite.args.filter((arg) => arg === base.input)).toHaveLength(10)
    expect(sprite.args.join(' ')).toContain('hstack=inputs=10')
    expect(sprite.args.at(-1)).toBe('id-key.sprite.jpg')
  })
})

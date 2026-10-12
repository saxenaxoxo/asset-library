import { describe, expect, it } from 'vitest'
import { ffmpegVersion } from '../../src/main/media/version'

describe('ffmpegVersion', () => {
  it('reads release builds from every source we ship', () => {
    expect(
      ffmpegVersion('ffprobe version 9.0.2 Copyright (c) 2007-2026 the FFmpeg developers')
    ).toBe('9.0.2')
    expect(
      ffmpegVersion('ffprobe version n9.0.2-25-g67b60c310b-20261011 Copyright (c) 2007-2026')
    ).toBe('9.0.2')
    expect(ffmpegVersion('ffprobe version 9.0 Copyright')).toBe('9.0')
  })

  it('keeps unusual version strings instead of guessing', () => {
    expect(ffmpegVersion('ffprobe version N-121000-g1234abcd Copyright')).toBe('N-121000-g1234abcd')
  })
})

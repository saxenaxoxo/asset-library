/**
 * Normalizes the first line of `ffprobe -version` to a plain version number.
 * "ffprobe version 9.0.2 Copyright…" → "9.0.2"
 * "ffprobe version n9.0.2-25-g67b60c310b-20261011 Copyright…" (BtbN builds) → "9.0.2"
 * "ffprobe version N-121000-g1234abcd" (git master) → "N-121000-g1234abcd" (kept as-is)
 */
export function ffmpegVersion(firstLine: string): string {
  const raw = firstLine.replace(/^ff(probe|mpeg) version\s+/, '').split(' ')[0] ?? ''
  const release = /^n?(\d+\.\d+(?:\.\d+)?)/.exec(raw)
  return release?.[1] ?? raw
}

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = join(
  __dirname,
  '..',
  '..',
  'resources',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)

export const hasFfmpeg = existsSync(FFMPEG)

function ffmpeg(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
}

/** Generates small, original test media (no third-party content). */
export function createFixtureLibrary(dir: string): void {
  mkdirSync(join(dir, 'Overlays'), { recursive: true })
  mkdirSync(join(dir, 'SFX'), { recursive: true })
  mkdirSync(join(dir, 'Textures'), { recursive: true })
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1280x720:rate=25:duration=2',
    '-c:v',
    'mpeg4',
    join(dir, 'Test Pattern.mp4')
  ])
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x8B5CF6@0.5:size=640x360:rate=25:duration=1,format=yuva444p10le',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4444',
    '-pix_fmt',
    'yuva444p10le',
    join(dir, 'Overlays', 'Purple Glow Overlay.mov')
  ])
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:duration=1.5',
    '-ac',
    '2',
    join(dir, 'SFX', 'Tone Hit.wav')
  ])
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=white@0.3:size=512x512,format=rgba',
    '-frames:v',
    '1',
    join(dir, 'Textures', 'Soft Grain.png')
  ])
}

/** SHA-256 of every file under dir, to prove the app never modifies originals. */
export function checksums(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(full, rel)
      else result[rel] = createHash('sha256').update(readFileSync(full)).digest('hex')
    }
  }
  walk(dir, '')
  return result
}

/**
 * Where tests point the app's panel download list: a closed port on this computer, so the app
 * behaves as if offline and never reaches the real download server.
 */
export const OFFLINE_MANIFEST_URL = 'http://127.0.0.1:9/panels-manifest.json'

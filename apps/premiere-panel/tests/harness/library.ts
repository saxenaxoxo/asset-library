// A small library on disk for the harness: a catalog with three assets and real thumbnails
// (made with the bundled FFmpeg), under a temporary home folder.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FFMPEG = join(
  __dirname,
  '..',
  '..',
  '..',
  'desktop',
  'resources',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  'ffmpeg'
)

function thumb(file: string, source: string): string {
  execFileSync(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-frames:v',
    '1',
    file
  ])
  return file
}

export interface TestLibrary {
  home: string
  catalogDir: string
  /** Request files the panel has written for the engine, oldest first. */
  requests(): Record<string, unknown>[]
  requestIds(): string[]
  /** Pretends the engine is running, optionally reporting results for requests. */
  engineStatus(results?: { id: string; ok: boolean; message: string }[]): void
}

export function createLibrary(): TestLibrary {
  const home = mkdtempSync(join(tmpdir(), 'asset-library-panel-'))
  const catalogDir = join(home, 'Library', 'Application Support', 'Asset Library', 'catalog')
  const media = join(home, 'media')
  mkdirSync(catalogDir, { recursive: true })
  mkdirSync(media, { recursive: true })
  const base = {
    fps: 25,
    favorite: false,
    tags: [],
    sprite: null,
    preview: null,
    wave: null,
    root: 'SSD'
  }
  const catalog = {
    version: 1,
    updatedAt: 1,
    app: '0.1.0',
    roots: [{ id: 1, label: 'SSD', online: true, path: '/Volumes/SSD' }],
    tags: [],
    assets: [
      {
        ...base,
        id: 'a',
        name: 'Glitch 04.mov',
        kind: 'video',
        path: '/Volumes/SSD/Transitions/Glitch 04.mov',
        folder: 'Transitions',
        durationMs: 1200,
        width: 1920,
        height: 1080,
        hasAlpha: false,
        addedAt: 3,
        thumb: thumb(join(media, 'a.jpg'), 'testsrc=size=480x270')
      },
      {
        ...base,
        id: 'b',
        name: 'Light Leak.mov',
        kind: 'video',
        path: '/Volumes/SSD/Overlays/Light Leak.mov',
        folder: 'Overlays',
        durationMs: 4000,
        width: 3840,
        height: 2160,
        hasAlpha: true,
        favorite: true,
        addedAt: 2,
        thumb: thumb(join(media, 'b.png'), 'color=c=0xA78BFA@0.5:size=480x270,format=rgba')
      },
      {
        ...base,
        id: 'c',
        name: 'Whoosh Big.wav',
        kind: 'audio',
        path: '/Volumes/SSD/SFX/Whoosh Big.wav',
        folder: 'SFX',
        durationMs: 2300,
        width: null,
        height: null,
        hasAlpha: null,
        addedAt: 1,
        thumb: null,
        wave: thumb(join(media, 'c.png'), 'color=c=0x1e1e25:size=480x96')
      }
    ]
  }
  writeFileSync(join(catalogDir, 'catalog.json'), JSON.stringify(catalog))

  const requestsDir = join(catalogDir, 'requests')
  const requestIds = (): string[] =>
    existsSync(requestsDir)
      ? readdirSync(requestsDir)
          .sort()
          .map((name) => name.replace(/\.json$/, ''))
      : []
  return {
    home,
    catalogDir,
    requestIds,
    requests: () =>
      requestIds().map(
        (id) =>
          JSON.parse(readFileSync(join(requestsDir, `${id}.json`), 'utf8')) as Record<
            string,
            unknown
          >
      ),
    engineStatus: (results = []) =>
      writeFileSync(
        join(catalogDir, 'engine.json'),
        JSON.stringify({
          version: '0.1.0',
          updatedAt: Date.now(),
          indexing: { rootIds: [], filesSeen: 0 },
          pendingMedia: 0,
          settings: { startAtLogin: true },
          cacheBytes: 12 * 1024 * 1024,
          importsFolder: '/Users/me/Movies/Asset Library Imports',
          results: results.map((r) => ({ ...r, at: Date.now() }))
        })
      )
  }
}

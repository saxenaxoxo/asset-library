import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  fingerprintFile,
  isExcluded,
  RootUnavailableError,
  scanRoot
} from '../../src/main/worker/scanner'
import type { ScanEntry } from '../../src/main/library/types'

let root: string

function file(relPath: string, content = 'x'): void {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

async function scanAll(
  exclusions: string[] = [],
  known: Record<string, { size: number; mtime: number; fingerprint: string | null }> = {}
): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = []
  await scanRoot({
    rootPath: root,
    exclusions,
    known,
    onBatch: (b) => entries.push(...b),
    batchSize: 2
  })
  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-library-scan-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanRoot', () => {
  it('finds supported files recursively, with forward-slash relative paths', async () => {
    file('Overlays/Light Leaks/leak 01.mov')
    file('SFX/whoosh.wav')
    file('readme.txt')
    const entries = await scanAll()
    expect(entries.map((e) => e.relPath)).toEqual([
      'Overlays/Light Leaks/leak 01.mov',
      'SFX/whoosh.wav'
    ])
    expect(entries.every((e) => e.fingerprint)).toBe(true)
  })

  it('skips hidden files, system folders and Premiere caches', async () => {
    file('.hidden/a.mp4')
    file('._a.mp4')
    file('$RECYCLE.BIN/b.mp4')
    file('Media Cache Files/c.mov')
    file('keep.mp4')
    expect((await scanAll()).map((e) => e.relPath)).toEqual(['keep.mp4'])
  })

  it('honours excluded folders', async () => {
    file('Footage/raw/a.mp4')
    file('Footage/selects/b.mp4')
    expect((await scanAll(['Footage/raw'])).map((e) => e.relPath)).toEqual([
      'Footage/selects/b.mp4'
    ])
  })

  it('does not follow symlinks out of the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'asset-library-outside-'))
    writeFileSync(join(outside, 'secret.mp4'), 'x')
    symlinkSync(outside, join(root, 'link'))
    file('real.mp4')
    expect((await scanAll()).map((e) => e.relPath)).toEqual(['real.mp4'])
    rmSync(outside, { recursive: true, force: true })
  })

  it('reuses the stored fingerprint for unchanged files', async () => {
    file('a.mp4', 'hello')
    const fixed = new Date('2026-01-01T00:00:00Z')
    utimesSync(join(root, 'a.mp4'), fixed, fixed)
    const known = { 'a.mp4': { size: 5, mtime: fixed.getTime(), fingerprint: 'stored' } }
    expect((await scanAll([], known))[0]?.fingerprint).toBe('stored')
  })

  it('reports a missing root as unavailable rather than empty', async () => {
    rmSync(root, { recursive: true, force: true })
    await expect(scanAll()).rejects.toBeInstanceOf(RootUnavailableError)
  })
})

describe('fingerprintFile', () => {
  it('is the same for identical content and different otherwise', async () => {
    file('a.wav', 'same bytes')
    file('b.wav', 'same bytes')
    file('c.wav', 'other bytes')
    const [a, b, c] = await Promise.all(
      ['a.wav', 'b.wav', 'c.wav'].map((f) => fingerprintFile(join(root, f), 10))
    )
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('handles empty and large files', async () => {
    file('empty.wav', '')
    file('large.wav', 'x'.repeat(300 * 1024))
    expect(await fingerprintFile(join(root, 'empty.wav'), 0)).toMatch(/^[0-9a-f]{40}$/)
    expect(await fingerprintFile(join(root, 'large.wav'), 300 * 1024)).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('isExcluded', () => {
  it('matches the folder and everything inside, but not similar names', () => {
    expect(isExcluded('Footage/raw', ['Footage/raw'])).toBe(true)
    expect(isExcluded('Footage/raw/a.mp4', ['Footage/raw'])).toBe(true)
    expect(isExcluded('Footage/raw-2/a.mp4', ['Footage/raw'])).toBe(false)
  })
})

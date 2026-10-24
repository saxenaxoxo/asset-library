import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IoWatchdog } from '../../src/main/engine/io-watchdog'

// The first heartbeat write never finishes (as when the app's file work stopped answering);
// later ones go through.
let hangNext = false
vi.mock('../../src/main/catalog/atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/catalog/atomic-file')>()
  return {
    ...actual,
    writeFileAtomic: (dir: string, name: string, text: string) => {
      if (hangNext) {
        hangNext = false
        return new Promise<string>(() => {})
      }
      return actual.writeFileAtomic(dir, name, text)
    }
  }
})

const { EngineStatusWriter, WRITE_TIMEOUT_MS } = await import('../../src/main/engine/status')

describe('EngineStatusWriter after a write that never finishes', () => {
  let dir = ''
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('gives up on it and keeps the heartbeat going', async () => {
    dir = mkdtempSync(join(tmpdir(), 'asset-library-stall-'))
    let clock = 1_000
    const writer = new EngineStatusWriter(
      join(dir, 'catalog'),
      {
        version: '0.2.1',
        importsFolder: '/imports',
        mediaDir: join(dir, 'media'),
        indexing: () => ({ rootIds: [], filesSeen: 0 }),
        pendingMedia: () => 0,
        startAtLogin: () => true
      },
      3000,
      () => clock
    )
    hangNext = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stuck = writer.write()
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    await stuck
    vi.useRealTimers()
    clock = 2_000
    await writer.write()
    const status = JSON.parse(readFileSync(join(dir, 'catalog', 'engine.json'), 'utf8')) as {
      updatedAt: number
    }
    expect(status.updatedAt).toBe(2_000)
    await writer.shutdown()
  })
})

describe('IoWatchdog', () => {
  it('does nothing while its file checks answer', async () => {
    let now = 0
    const onStall = vi.fn()
    const watchdog = new IoWatchdog({
      probe: () => Promise.resolve(),
      onStall,
      stallAfterMs: 45_000,
      now: () => now
    })
    for (let i = 0; i < 10; i++) {
      watchdog.tick()
      await Promise.resolve()
      now += 15_000
    }
    expect(onStall).not.toHaveBeenCalled()
  })

  it('asks for a restart, once, when a check hasn’t answered for long enough', () => {
    let now = 0
    const onStall = vi.fn()
    const watchdog = new IoWatchdog({
      probe: () => new Promise(() => {}),
      onStall,
      stallAfterMs: 45_000,
      now: () => now
    })
    watchdog.tick() // starts a check that never answers
    now = 30_000
    watchdog.tick()
    expect(onStall).not.toHaveBeenCalled()
    now = 45_000
    watchdog.tick()
    now = 90_000
    watchdog.tick()
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(onStall).toHaveBeenCalledWith(45_000)
  })

  it('a slow but answered check starts the clock again', async () => {
    let now = 0
    let answer: () => void = () => {}
    const onStall = vi.fn()
    const watchdog = new IoWatchdog({
      probe: () =>
        new Promise<void>((resolve) => {
          answer = resolve
        }),
      onStall,
      stallAfterMs: 45_000,
      now: () => now
    })
    watchdog.tick()
    now = 40_000
    answer()
    await Promise.resolve()
    await Promise.resolve()
    watchdog.tick() // a new check at 40 s
    now = 80_000
    watchdog.tick()
    expect(onStall).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ utilityProcess: {} }))
const { openDatabase } = await import('../../src/main/library/database')
const { migrate } = await import('../../src/main/library/migrations')
const { LibraryRepository } = await import('../../src/main/library/repository')
const { LibraryService } = await import('../../src/main/library/service')

afterEach(() => vi.useRealTimers())

function setup(): {
  db: ReturnType<typeof openDatabase>
  service: InstanceType<typeof LibraryService>
  events: string[]
} {
  const db = openDatabase(':memory:')
  migrate(db)
  const repo = new LibraryRepository(db)
  const worker = { request: vi.fn(() => new Promise(() => undefined)), stop: vi.fn() }
  const events: string[] = []
  const service = new LibraryService(
    repo,
    worker as never,
    { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    { mediaDir: '/nonexistent/media', catalogDir: '/nonexistent/catalog', appVersion: '0.0.0' },
    (event) => events.push(event.type)
  )
  return { db, service, events }
}

describe('LibraryService shutdown', () => {
  it('does not touch the database after stop(), even when timers fire later', () => {
    vi.useFakeTimers()
    const { db, service, events } = setup()
    service.organizingChanged() // schedules a UI refresh and, after it, a catalog write
    service.stop()
    db.close()
    // Previously this threw "The database connection is not open" from the catalog timer.
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(events).toEqual([])
  })

  it('still refreshes normally while running', () => {
    vi.useFakeTimers()
    const { db, service, events } = setup()
    service.organizingChanged()
    vi.advanceTimersByTime(500)
    expect(events).toEqual(['library-changed'])
    service.stop()
    db.close()
    expect(() => vi.runAllTimers()).not.toThrow()
  })
})

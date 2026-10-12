import { afterEach, describe, expect, it } from 'vitest'
import {
  databaseCapabilities,
  openDatabase,
  type LibraryDatabase
} from '../../src/main/library/database'

let db: LibraryDatabase | undefined

afterEach(() => db?.close())

describe('library database', () => {
  it('opens with foreign keys enforced', () => {
    db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('has FTS5 available for search', () => {
    db = openDatabase(':memory:')
    const caps = databaseCapabilities(db)
    expect(caps.fts5).toBe(true)
    expect(caps.sqliteVersion).toMatch(/^3\.\d+\.\d+$/)
  })
})

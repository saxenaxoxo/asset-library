import Database from 'better-sqlite3'

export type LibraryDatabase = Database.Database

/** Opens (or creates) the library database with the settings every connection needs. */
export function openDatabase(file: string): LibraryDatabase {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export interface DatabaseCapabilities {
  sqliteVersion: string
  fts5: boolean
}

/** Reports the SQLite build in use. FTS5 is required for search. */
export function databaseCapabilities(db: LibraryDatabase): DatabaseCapabilities {
  const sqliteVersion = (db.prepare('select sqlite_version() as v').get() as { v: string }).v
  let fts5 = true
  try {
    db.exec('create virtual table temp.fts5_probe using fts5(x); drop table temp.fts5_probe;')
  } catch {
    fts5 = false
  }
  return { sqliteVersion, fts5 }
}

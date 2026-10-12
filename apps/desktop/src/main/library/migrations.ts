import type { LibraryDatabase } from './database'
import m0001 from './migrations/0001-initial.sql?raw'
import m0002 from './migrations/0002-media.sql?raw'
import m0003 from './migrations/0003-search-ids.sql?raw'

/**
 * Schema migrations, applied in order. Each lives in ./migrations/NNNN-name.sql and is append
 * only: never edit one once it has shipped. Add a new file and list it
 * here. The database's `user_version` is the number applied.
 */
export const MIGRATIONS: readonly string[] = [m0001, m0002, m0003]

export const SCHEMA_VERSION = MIGRATIONS.length

export interface MigrationResult {
  from: number
  to: number
}

/**
 * Brings the schema up to date in one transaction; a failure leaves the database untouched.
 * Call `backup` first when `needsMigration` is true so a bad upgrade can be recovered.
 */
export function migrate(db: LibraryDatabase): MigrationResult {
  const from = db.pragma('user_version', { simple: true }) as number
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `This library was created by a newer version of Asset Library (schema ${from}). Update the app to open it.`
    )
  }
  const apply = db.transaction(() => {
    for (let version = from; version < SCHEMA_VERSION; version++) {
      db.exec(MIGRATIONS[version] as string)
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })
  apply()
  return { from, to: SCHEMA_VERSION }
}

export function needsMigration(db: LibraryDatabase): boolean {
  return (db.pragma('user_version', { simple: true }) as number) < SCHEMA_VERSION
}

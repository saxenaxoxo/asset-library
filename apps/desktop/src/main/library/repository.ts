import { randomUUID } from 'crypto'
import nodePath from 'path'
import type { Statement } from 'better-sqlite3'
import type { LibraryDatabase } from './database'
import { extensionOf, kindForFile, type AssetKind } from '@shared/media-types'
import type {
  AssetQuery,
  AssetRecord,
  AssetSort,
  MediaFiles,
  PendingMedia,
  ProbeResult,
  RootRecord,
  ScanEntry,
  ScanSummary
} from './types'

interface AssetRow {
  id: string
  root_id: number
  rel_path: string
  filename: string
  ext: string
  kind: AssetKind
  size: number
  mtime: number
  width: number | null
  height: number | null
  duration_ms: number | null
  fps: number | null
  codec: string | null
  has_alpha: number | null
  channels: number | null
  sample_rate: number | null
  probe_state: 'pending' | 'done' | 'error'
  status: 'ok' | 'missing' | 'error'
  error_msg: string | null
  favorite: number
  notes: string | null
  added_at: number
  root_status: 'ok' | 'offline'
  tags: string | null
  media_state: 'pending' | 'done' | 'error'
  media_key: string | null
  thumb_file: string | null
  sprite_file: string | null
  preview_file: string | null
  wave_file: string | null
}

const SORT_SQL: Record<AssetSort, string> = {
  added: 'a.added_at desc, a.filename, a.id',
  name: 'a.filename collate nocase, a.rel_path, a.id',
  modified: 'a.mtime desc, a.filename, a.id',
  size: 'a.size desc, a.filename, a.id',
  duration: 'a.duration_ms is null, a.duration_ms desc, a.filename, a.id'
}

/** One asset as `catalogRows()` returns it. Booleans are SQLite integers; tags joined by \u001f. */
export interface CatalogRow {
  id: string
  rootId: number
  rootPath: string
  relPath: string
  filename: string
  kind: AssetKind
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAlpha: number | null
  favorite: number
  addedAt: number
  thumb: string | null
  sprite: string | null
  preview: string | null
  wave: string | null
  tags: string | null
}

/** "Recently added" means added in the last 14 days. */
export const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    relPath: row.rel_path,
    filename: row.filename,
    ext: row.ext,
    kind: row.kind,
    size: row.size,
    mtime: row.mtime,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    fps: row.fps,
    codec: row.codec,
    hasAlpha: row.has_alpha === null ? null : row.has_alpha === 1,
    channels: row.channels,
    sampleRate: row.sample_rate,
    probeState: row.probe_state,
    status: row.root_status === 'offline' ? 'offline' : row.status,
    errorMessage: row.error_msg,
    favorite: row.favorite === 1,
    notes: row.notes,
    addedAt: row.added_at,
    tags: row.tags ? row.tags.split('\u001f') : [],
    media: {
      state: row.media_state,
      key: row.media_key,
      thumb: row.thumb_file !== null,
      sprite: row.sprite_file !== null,
      preview: row.preview_file !== null,
      wave: row.wave_file !== null
    }
  }
}

/** Search words too short for the trigram index (1–2 characters). */
export function shortWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0 && word.length < 3)
}

/** Builds an FTS5 query that matches every word as a substring (trigram), safely quoted. */
export function ftsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
  if (words.length === 0) return null
  return words.map((word) => `"${word.replaceAll('"', '""')}"`).join(' AND ')
}

/** All database access for the library. Synchronous (better-sqlite3); keep calls small. */
export class LibraryRepository {
  private readonly statements = new Map<string, Statement>()

  constructor(
    private readonly db: LibraryDatabase,
    private readonly now: () => number = Date.now
  ) {}

  /** Prepares a statement once and reuses it; hot paths run thousands of times per scan. */
  private sql(text: string): Statement {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }

  // ── Roots ────────────────────────────────────────────────────────────────

  addRoot(path: string, label: string): RootRecord {
    const existing = this.db.prepare('select id from roots where path = ?').get(path) as
      { id: number } | undefined
    if (existing) return this.getRoot(existing.id) as RootRecord
    const info = this.db
      .prepare('insert into roots (path, label, added_at) values (?, ?, ?)')
      .run(path, label, this.now())
    return this.getRoot(Number(info.lastInsertRowid)) as RootRecord
  }

  getRoot(id: number): RootRecord | null {
    const row = this.db
      .prepare(
        `select r.id, r.path, r.label, r.status, r.added_at as addedAt, r.last_scan_at as lastScanAt,
          (select count(*) from assets a where a.root_id = r.id) as assetCount,
          exists(select 1 from scans s where s.root_id = r.id and s.state = 'running') as scanning
         from roots r where r.id = ?`
      )
      .get(id) as (Omit<RootRecord, 'scanning'> & { scanning: number }) | undefined
    return row ? { ...row, scanning: row.scanning === 1 } : null
  }

  hasRoot(id: number): boolean {
    return this.sql('select 1 from roots where id = ?').get(id) !== undefined
  }

  listRoots(): RootRecord[] {
    const ids = this.db.prepare('select id from roots order by label collate nocase').all() as {
      id: number
    }[]
    return ids.map(({ id }) => this.getRoot(id) as RootRecord)
  }

  /** Forgets a root and its index entries. Never touches the files on disk. */
  removeRoot(id: number): void {
    const remove = this.db.transaction(() => {
      this.db
        .prepare(
          'delete from assets_fts where rowid in (select search_id from assets where root_id = ?)'
        )
        .run(id)
      this.db.prepare('delete from roots where id = ?').run(id)
    })
    remove()
  }

  setRootStatus(id: number, status: 'ok' | 'offline'): void {
    this.db.prepare('update roots set status = ? where id = ?').run(status, id)
  }

  listExclusions(rootId: number): string[] {
    return (
      this.db
        .prepare('select rel_path from exclusions where root_id = ? order by rel_path')
        .all(rootId) as {
        rel_path: string
      }[]
    ).map((row) => row.rel_path)
  }

  addExclusion(rootId: number, relPath: string): void {
    this.db
      .prepare('insert or ignore into exclusions (root_id, rel_path) values (?, ?)')
      .run(rootId, relPath)
  }

  removeExclusion(rootId: number, relPath: string): void {
    this.db
      .prepare('delete from exclusions where root_id = ? and rel_path = ?')
      .run(rootId, relPath)
  }

  // ── Scans ────────────────────────────────────────────────────────────────

  /** Marks scans left "running" by a crash as aborted. Aborted scans never mark files missing. */
  recoverInterruptedScans(): number {
    return this.db
      .prepare(`update scans set state = 'aborted', finished_at = ? where state = 'running'`)
      .run(this.now()).changes
  }

  startScan(rootId: number): number {
    const info = this.db
      .prepare(`insert into scans (root_id, started_at, state) values (?, ?, 'running')`)
      .run(rootId, this.now())
    return Number(info.lastInsertRowid)
  }

  /** Size, mtime and fingerprint of every indexed file, so the scanner can skip unchanged ones. */
  knownFiles(
    rootId: number
  ): Record<string, { size: number; mtime: number; fingerprint: string | null }> {
    const rows = this.db
      .prepare('select rel_path, size, mtime, fingerprint from assets where root_id = ?')
      .all(rootId) as {
      rel_path: string
      size: number
      mtime: number
      fingerprint: string | null
    }[]
    const known: Record<string, { size: number; mtime: number; fingerprint: string | null }> = {}
    for (const row of rows)
      known[row.rel_path] = { size: row.size, mtime: row.mtime, fingerprint: row.fingerprint }
    return known
  }

  /** Records a batch of files seen by the scanner, in one transaction. */
  applyScanBatch(rootId: number, scanId: number, entries: readonly ScanEntry[]): void {
    const now = this.now()
    const select = this.db.prepare(
      'select id, size, mtime from assets where root_id = ? and rel_path = ?'
    )
    const touch = this.db.prepare(
      `update assets set last_seen_scan = ?, status = case when status = 'missing' then 'ok' else status end
       where id = ?`
    )
    const update = this.db.prepare(
      `update assets set size = ?, mtime = ?, fingerprint = ?, indexed_at = ?, last_seen_scan = ?,
         status = ?, error_msg = ?, probe_state = 'pending', media_state = 'pending'
       where id = ?`
    )
    const insert = this.db.prepare(
      `insert into assets (id, root_id, rel_path, filename, ext, kind, size, mtime, fingerprint,
         status, error_msg, added_at, indexed_at, last_seen_scan, search_id)
       values (@id, @rootId, @relPath, @filename, @ext, @kind, @size, @mtime, @fingerprint,
         @status, @error, @now, @now, @scanId,
         (select coalesce(max(search_id), 0) + 1 from assets))`
    )
    const apply = this.db.transaction(() => {
      for (const entry of entries) {
        const kind = kindForFile(entry.filename)
        if (!kind) continue
        const existing = select.get(rootId, entry.relPath) as
          { id: string; size: number; mtime: number } | undefined
        const status = entry.error ? 'error' : 'ok'
        if (existing) {
          if (existing.size === entry.size && existing.mtime === entry.mtimeMs && !entry.error) {
            touch.run(scanId, existing.id)
          } else {
            update.run(
              entry.size,
              entry.mtimeMs,
              entry.fingerprint,
              now,
              scanId,
              status,
              entry.error ?? null,
              existing.id
            )
            this.refreshSearch(existing.id)
          }
        } else {
          const id = randomUUID()
          insert.run({
            id,
            rootId,
            relPath: entry.relPath,
            filename: entry.filename,
            ext: extensionOf(entry.filename),
            kind,
            size: entry.size,
            mtime: entry.mtimeMs,
            fingerprint: entry.fingerprint,
            status,
            error: entry.error ?? null,
            now,
            scanId
          })
          this.refreshSearch(id, true)
        }
      }
      this.db
        .prepare('update scans set files_seen = files_seen + ? where id = ?')
        .run(entries.length, scanId)
    })
    apply()
  }

  /**
   * Completes a scan: files that moved within the root keep their ID, favorite, notes and tags;
   * files not seen in this complete scan become "missing" (their data is kept, never deleted).
   */
  finishScan(rootId: number, scanId: number): ScanSummary {
    const finish = this.db.transaction((): ScanSummary => {
      const unseen = this.db
        .prepare(
          `select id, fingerprint from assets
           where root_id = ? and last_seen_scan < ? and status != 'missing'`
        )
        .all(rootId, scanId) as { id: string; fingerprint: string | null }[]
      const scan = this.db.prepare('select started_at from scans where id = ?').get(scanId) as
        { started_at: number } | undefined
      if (!scan) throw new Error('This scan was cancelled.')
      const scanStart = scan.started_at
      const added = this.db
        .prepare(
          `select id, rel_path, filename, fingerprint from assets
           where root_id = ? and last_seen_scan = ? and added_at >= ?`
        )
        .all(rootId, scanId, scanStart) as {
        id: string
        rel_path: string
        filename: string
        fingerprint: string | null
      }[]

      // Move detection: an unseen file and a new file with the same fingerprint are one file.
      const newByFingerprint = new Map<string, (typeof added)[number]>()
      for (const row of added) if (row.fingerprint) newByFingerprint.set(row.fingerprint, row)
      let moved = 0
      const stillUnseen: string[] = []
      for (const old of unseen) {
        const match = old.fingerprint ? newByFingerprint.get(old.fingerprint) : undefined
        if (!match) {
          stillUnseen.push(old.id)
          continue
        }
        newByFingerprint.delete(old.fingerprint as string)
        // Keep anything the user did to the new copy while the scan was running.
        this.db
          .prepare(
            'insert or ignore into asset_tags (asset_id, tag_id) select ?, tag_id from asset_tags where asset_id = ?'
          )
          .run(old.id, match.id)
        this.db
          .prepare(
            'update assets set favorite = max(favorite, (select favorite from assets where id = ?)) where id = ?'
          )
          .run(match.id, old.id)
        this.db
          .prepare(
            'delete from assets_fts where rowid = (select search_id from assets where id = ?)'
          )
          .run(match.id)
        this.db.prepare('delete from assets where id = ?').run(match.id)
        this.db
          .prepare(
            `update assets set rel_path = ?, filename = ?, ext = ?, last_seen_scan = ?, status = 'ok'
             where id = ?`
          )
          .run(match.rel_path, match.filename, extensionOf(match.filename), scanId, old.id)
        this.refreshSearch(old.id)
        moved++
      }

      const markMissing = this.db.prepare(`update assets set status = 'missing' where id = ?`)
      for (const id of stillUnseen) markMissing.run(id)

      this.db
        .prepare(`update scans set state = 'done', finished_at = ? where id = ?`)
        .run(this.now(), scanId)
      this.db
        .prepare(`delete from scans where root_id = ? and id != ? and state != 'running'`)
        .run(rootId, scanId)
      this.db
        .prepare('update roots set last_scan_at = ?, status = ? where id = ?')
        .run(this.now(), 'ok', rootId)

      const filesSeen = (
        this.db.prepare('select files_seen from scans where id = ?').get(scanId) as {
          files_seen: number
        }
      ).files_seen
      return { filesSeen, added: added.length - moved, moved, missing: stillUnseen.length }
    })
    return finish()
  }

  /** Stops a scan without drawing conclusions (e.g. the drive was unplugged mid-scan). */
  abortScan(scanId: number): void {
    this.db
      .prepare(`update scans set state = 'aborted', finished_at = ? where id = ?`)
      .run(this.now(), scanId)
  }

  // ── Metadata ─────────────────────────────────────────────────────────────

  pendingProbes(
    limit: number
  ): { id: string; path: string; kind: AssetKind; fingerprint: string | null }[] {
    const rows = this.db
      .prepare(
        `select a.id, a.rel_path, a.kind, a.fingerprint, r.path as root_path
         from assets a join roots r on r.id = a.root_id
         where a.probe_state = 'pending' and a.status = 'ok' and r.status = 'ok' and a.kind != 'template'
         order by a.added_at desc limit ?`
      )
      .all(limit) as {
      id: string
      rel_path: string
      kind: AssetKind
      fingerprint: string | null
      root_path: string
    }[]
    return rows.flatMap((row) => {
      const path = safeJoin(row.root_path, row.rel_path)
      return path ? [{ id: row.id, kind: row.kind, path, fingerprint: row.fingerprint }] : []
    })
  }

  /**
   * Saves probe results, unless the file changed while it was being probed (a rescan reset it
   * to pending with a new fingerprint); then the stale result is dropped and it's probed again.
   */
  saveProbe(id: string, fingerprint: string | null, result: ProbeResult): void {
    this.sql(
      `update assets set width = ?, height = ?, duration_ms = ?, fps = ?, codec = ?, has_alpha = ?,
         channels = ?, sample_rate = ?, probe_state = 'done'
       where id = ? and probe_state = 'pending' and fingerprint is ?`
    ).run(
      result.width,
      result.height,
      result.durationMs,
      result.fps,
      result.codec,
      result.hasAlpha === null ? null : result.hasAlpha ? 1 : 0,
      result.channels,
      result.sampleRate,
      id,
      fingerprint
    )
  }

  saveProbeError(id: string, fingerprint: string | null, message: string): void {
    this.sql(
      `update assets set probe_state = 'error', error_msg = ?
       where id = ? and probe_state = 'pending' and fingerprint is ?`
    ).run(message, id, fingerprint)
  }

  // ── Generated media ──────────────────────────────────────────────────────

  /** Assets whose details are known but whose thumbnails/previews haven't been generated. */
  pendingMedia(limit: number): PendingMedia[] {
    const rows = this.db
      .prepare(
        `select a.id, a.rel_path, a.kind, a.has_alpha, a.duration_ms, a.width, a.height, a.fingerprint,
           r.path as root_path
         from assets a join roots r on r.id = a.root_id
         where a.media_state = 'pending' and a.probe_state != 'pending' and a.status = 'ok'
           and r.status = 'ok' and a.kind != 'template'
         order by a.favorite desc, a.added_at desc limit ?`
      )
      .all(limit) as {
      id: string
      rel_path: string
      kind: AssetKind
      has_alpha: number | null
      duration_ms: number | null
      width: number | null
      height: number | null
      fingerprint: string | null
      root_path: string
    }[]
    return rows.flatMap((row) => {
      const path = safeJoin(row.root_path, row.rel_path)
      if (!path) return []
      return [
        {
          id: row.id,
          path,
          kind: row.kind,
          hasAlpha: row.has_alpha === null ? null : row.has_alpha === 1,
          durationMs: row.duration_ms,
          width: row.width,
          height: row.height,
          key: mediaKey(row.fingerprint)
        }
      ]
    })
  }

  /** Saves generated media, unless the file changed meanwhile (its key no longer matches). */
  saveMedia(id: string, key: string, files: MediaFiles): void {
    this.sql(
      `update assets set media_state = 'done', media_key = ?, thumb_file = ?, sprite_file = ?,
         preview_file = ?, wave_file = ?
       where id = ? and media_state = 'pending' and ${MEDIA_KEY_SQL} = ?`
    ).run(key, files.thumb, files.sprite, files.preview, files.wave, id, key)
  }

  saveMediaError(id: string, key: string): void {
    this.sql(
      `update assets set media_state = 'error'
       where id = ? and media_state = 'pending' and ${MEDIA_KEY_SQL} = ?`
    ).run(id, key)
  }

  /** Cached media file names for an asset (relative to the media folder). */
  mediaFiles(id: string): MediaFiles | null {
    const row = this.db
      .prepare('select thumb_file, sprite_file, preview_file, wave_file from assets where id = ?')
      .get(id) as
      | {
          thumb_file: string | null
          sprite_file: string | null
          preview_file: string | null
          wave_file: string | null
        }
      | undefined
    return row
      ? {
          thumb: row.thumb_file,
          sprite: row.sprite_file,
          preview: row.preview_file,
          wave: row.wave_file
        }
      : null
  }

  /** Every cached media file name still referenced, so cleanup can remove orphans. */
  referencedMediaFiles(): Set<string> {
    const rows = this.db
      .prepare('select thumb_file, sprite_file, preview_file, wave_file from assets')
      .all() as Record<string, string | null>[]
    const files = new Set<string>()
    for (const row of rows) for (const value of Object.values(row)) if (value) files.add(value)
    return files
  }

  /**
   * Every available asset (root online, file present) with what the panel catalog needs, in one
   * pass. Ordered newest first, like the app's default view.
   */
  catalogRows(): CatalogRow[] {
    return this.db
      .prepare(
        `select a.id, a.root_id as rootId, r.path as rootPath, a.rel_path as relPath,
           a.filename, a.kind, a.duration_ms as durationMs, a.width, a.height, a.fps,
           a.has_alpha as hasAlpha, a.favorite, a.added_at as addedAt,
           a.thumb_file as thumb, a.sprite_file as sprite, a.preview_file as preview,
           a.wave_file as wave,
           (select group_concat(t.name, char(31)) from asset_tags at join tags t on t.id = at.tag_id
             where at.asset_id = a.id) as tags
         from assets a join roots r on r.id = a.root_id
         where a.status = 'ok' and r.status = 'ok'
         order by ${SORT_SQL.added}`
      )
      .all() as CatalogRow[]
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  query(query: AssetQuery): { total: number; items: AssetRecord[] } {
    const where: string[] = []
    const params: unknown[] = []
    if (query.kind) {
      where.push('a.kind = ?')
      params.push(query.kind)
    }
    if (query.rootId !== undefined) {
      where.push('a.root_id = ?')
      params.push(query.rootId)
    }
    if (query.favoritesOnly) where.push('a.favorite = 1')
    if (query.recentOnly) {
      where.push('a.added_at >= ?')
      params.push(this.now() - RECENT_WINDOW_MS)
    }
    if (query.missingOnly) where.push(`a.status = 'missing'`)
    else if (!query.includeMissing) where.push(`a.status != 'missing'`)
    if (query.tag) {
      where.push(
        'a.id in (select at.asset_id from asset_tags at join tags t on t.id = at.tag_id where t.name = ?)'
      )
      params.push(query.tag)
    }
    const fts = query.text ? ftsQuery(query.text) : null
    if (fts) {
      where.push('a.search_id in (select rowid from assets_fts where assets_fts match ?)')
      params.push(fts)
    }
    // Words under 3 characters ("4k", "02") are too short for the trigram index; each one must
    // still match the name, folder or a tag, so "clip 02" doesn't return every clip.
    for (const word of shortWords(query.text ?? '')) {
      const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push(
        `(a.filename like ? escape '\\' or a.rel_path like ? escape '\\' or exists (
           select 1 from asset_tags at join tags t on t.id = at.tag_id
           where at.asset_id = a.id and t.name like ? escape '\\'))`
      )
      params.push(like, like, like)
    }
    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : ''
    const total = (
      this.db.prepare(`select count(*) as n from assets a ${whereSql}`).get(...params) as {
        n: number
      }
    ).n
    const rows = this.db
      .prepare(
        `select a.*, r.status as root_status,
           (select group_concat(t.name, char(31)) from asset_tags at join tags t on t.id = at.tag_id
             where at.asset_id = a.id) as tags
         from assets a join roots r on r.id = a.root_id
         ${whereSql}
         order by ${SORT_SQL[query.sort ?? 'added']}
         limit ? offset ?`
      )
      .all(...params, query.limit ?? 200, query.offset ?? 0) as AssetRow[]
    return { total, items: rows.map(toRecord) }
  }

  getAsset(id: string): AssetRecord | null {
    const row = this.db
      .prepare(
        `select a.*, r.status as root_status,
           (select group_concat(t.name, char(31)) from asset_tags at join tags t on t.id = at.tag_id
             where at.asset_id = a.id) as tags
         from assets a join roots r on r.id = a.root_id where a.id = ?`
      )
      .get(id) as AssetRow | undefined
    return row ? toRecord(row) : null
  }

  /**
   * The absolute path of an asset, or null if it can't be resolved safely. The result is always
   * inside the asset's root, so a tampered rel_path can never point elsewhere on disk.
   */
  assetPath(id: string): string | null {
    const row = this.db
      .prepare(
        'select a.rel_path, r.path as root_path from assets a join roots r on r.id = a.root_id where a.id = ?'
      )
      .get(id) as { rel_path: string; root_path: string } | undefined
    if (!row) return null
    return safeJoin(row.root_path, row.rel_path)
  }

  counts(): {
    total: number
    video: number
    audio: number
    image: number
    template: number
    favorites: number
    missing: number
  } {
    return this.db
      .prepare(
        `select count(*) filter (where status != 'missing') as total,
           count(*) filter (where kind = 'video' and status != 'missing') as video,
           count(*) filter (where kind = 'audio' and status != 'missing') as audio,
           count(*) filter (where kind = 'image' and status != 'missing') as image,
           count(*) filter (where kind = 'template' and status != 'missing') as template,
           count(*) filter (where favorite = 1 and status != 'missing') as favorites,
           count(*) filter (where status = 'missing') as missing
         from assets`
      )
      .get() as ReturnType<LibraryRepository['counts']>
  }

  // ── Organizing ───────────────────────────────────────────────────────────

  setFavorite(id: string, favorite: boolean): void {
    this.db.prepare('update assets set favorite = ? where id = ?').run(favorite ? 1 : 0, id)
  }

  setNotes(id: string, notes: string | null): void {
    this.db.prepare('update assets set notes = ? where id = ?').run(notes, id)
  }

  addTag(assetId: string, name: string): void {
    const tagName = name.trim()
    if (!tagName) return
    const add = this.db.transaction(() => {
      this.db.prepare('insert or ignore into tags (name) values (?)').run(tagName)
      const tag = this.db.prepare('select id from tags where name = ?').get(tagName) as {
        id: number
      }
      this.db
        .prepare('insert or ignore into asset_tags (asset_id, tag_id) values (?, ?)')
        .run(assetId, tag.id)
      this.refreshSearch(assetId)
    })
    add()
  }

  removeTag(assetId: string, name: string): void {
    const remove = this.db.transaction(() => {
      this.db
        .prepare(
          'delete from asset_tags where asset_id = ? and tag_id = (select id from tags where name = ?)'
        )
        .run(assetId, name)
      this.db.prepare('delete from tags where id not in (select tag_id from asset_tags)').run()
      this.refreshSearch(assetId)
    })
    remove()
  }

  listTags(): { name: string; count: number }[] {
    return this.db
      .prepare(
        `select t.name, count(at.asset_id) as count from tags t
         left join asset_tags at on at.tag_id = t.id group by t.id order by t.name collate nocase`
      )
      .all() as { name: string; count: number }[]
  }

  /** Rewrites an asset's search row. `fresh` skips the delete for assets that never had one. */
  private refreshSearch(assetId: string, fresh = false): void {
    if (!fresh) {
      this.sql(
        'delete from assets_fts where rowid = (select search_id from assets where id = ?)'
      ).run(assetId)
    }
    this.sql(
      `insert into assets_fts (rowid, filename, rel_path, tags)
       select a.search_id, a.filename, a.rel_path,
         coalesce((select group_concat(t.name, ' ') from asset_tags at join tags t on t.id = at.tag_id
           where at.asset_id = a.id), '')
       from assets a where a.id = ?`
    ).run(assetId)
  }
}

/** Short content key for generated media; changes when the file changes, so cache is never stale. */
export function mediaKey(fingerprint: string | null): string {
  return (fingerprint ?? 'nofp').slice(0, 10)
}

/** The same key computed in SQL, to check a result still belongs to the current file. */
const MEDIA_KEY_SQL = `substr(coalesce(fingerprint, 'nofp'), 1, 10)`

/**
 * Joins a root and a relative path, refusing anything that escapes the root. `path` is only
 * swapped in tests, to check Windows rules (drive letters, UNC shares) on any machine.
 */
export function safeJoin(
  rootPath: string,
  relPath: string,
  path: typeof nodePath = nodePath
): string | null {
  if (path.isAbsolute(relPath)) return null
  const root = path.resolve(rootPath)
  const full = path.resolve(root, relPath)
  const rel = path.relative(root, full)
  if (
    rel === '' ||
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.split(path.sep).includes('..')
  )
    return null
  return full
}

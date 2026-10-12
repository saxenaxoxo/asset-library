# Asset Library v1 — Product & Technical Spec

Asset Library by Saxenas Creation · Status: **approved to build (2026-10-11)** · Decisions: [decisions.md](decisions.md)

## 1. What v1 is

A free desktop app (macOS arm64 + x64, Windows x64) that indexes the creative assets a user already owns
(folders and external drives), shows them in a fast visual browser, previews them, and lets the user drag
the **original file** into Premiere Pro, After Effects, or any other app.

Positioning: _Eagle for video editors, free, local, no account._

### In scope (v1.0)

| Area          | Features                                                                                                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library roots | Add/remove folders and external drives; recursive scan; exclude sub-folders; rescan (manual + incremental on launch); offline-drive handling; "Locate folder…" for moved roots                                                                                                                                                               |
| Asset types   | **Video** (mp4, mov, m4v, webm, mkv, avi, mxf — incl. ProRes / alpha), **Audio** (wav, aif/aiff, mp3, m4a, aac, flac, ogg), **Images** (png, jpg/jpeg, webp, gif, tif/tiff, bmp, svg, psd-thumbnail-only). Adobe-native files (`.mogrt`, `.aep`, `.ffx`, `.prproj`, `.cube`) are indexed as **browse-only** with "Reveal in Finder/Explorer" |
| Browsing      | Virtualized thumbnail grid + list view, sidebar (All, Favorites, Recently added, Video, Audio, Images, Templates & presets, roots, tags, Missing), sort (name, date added, modified, size, duration), type filters                                                                                                                           |
| Search        | Instant full-text search over name, folder path, tags (SQLite FTS5)                                                                                                                                                                                                                                                                          |
| Organize      | Tags, favorites, notes (stored only in our DB — original files never touched)                                                                                                                                                                                                                                                                |
| Preview       | Image view; video playback + hover-scrub, alpha shown over a checkerboard; audio playback with waveform                                                                                                                                                                                                                                      |
| Insert        | OS-native drag-out of one or many originals (Electron `webContents.startDrag`); "Reveal in Finder/Explorer"; "Copy path"                                                                                                                                                                                                                     |
| Updates       | Check GitHub Releases on launch (toggle in Settings) → "Update available — Download" (no silent auto-update; app is unsigned)                                                                                                                                                                                                                |

### Explicitly out of v1

Premiere UXP panel, After Effects scripting bridge, live file watching, duplicate detection, collections,
AI tagging, light theme, Windows ARM, cloud anything, telemetry.

### Hard rules

1. **Never modify, move, rename, or delete user files.** No marker/sidecar files in user folders. All state lives in the app's own data folder.
2. Works fully offline with no account.
3. No telemetry. The only network call is the optional update check to GitHub.

## 2. Architecture

```
┌──────────────────────────── Electron app ─────────────────────────────┐
│ Renderer (React + TS + Tailwind, sandboxed, no Node)                  │
│   UI only. Talks to main through a typed, zod-validated preload API.  │
│        │ ipc (invoke/events)                         ▲ asset:// media │
│ Main process                                          │               │
│   • window, menus, IPC router (validates every message)               │
│   • Library service: owns SQLite (better-sqlite3, WAL)                │
│   • asset:// protocol: serves thumbnails/proxies/originals BY ID only │
│   • drag-out: ids → validated paths → webContents.startDrag           │
│        │ MessagePort                                                  │
│ Utility process "worker" (Node, no UI)                                │
│   • Scanner: walks roots, stats files, batches results to main        │
│   • Media jobs queue: spawns ffprobe/ffmpeg (arg arrays, no shell),   │
│     concurrency = min(4, cpus/2), per-job timeout                     │
└───────────────────────────────────────────────────────────────────────┘
App data:  <userData>/library.db, <userData>/cache/{thumbs,proxies,waveforms}/
```

Why this shape: the UI never blocks on disk or FFmpeg; there is exactly one database writer (main), fed in
batched transactions; no localhost server exists (the media protocol is in-process), which satisfies
"no unauthenticated local network services"; the renderer cannot name arbitrary paths — only asset IDs.

### Stack (versions verified 2026-10-11)

Electron 44.x · electron-vite 5 · electron-builder 26 (dmg + NSIS) · React 19 · TypeScript (strict) ·
Tailwind 4 · better-sqlite3 13 (FTS5) · TanStack Virtual · wavesurfer.js (BSD-3) · zod · Vitest ·
Playwright (`_electron`) · pnpm. FFmpeg/FFprobe: **LGPL builds only**, bundled as separate executables
in `extraResources` (BtbN lgpl for Windows; self-built LGPL for macOS in CI). Dev may use the system FFmpeg.

## 3. Data model (SQLite, migrations via `PRAGMA user_version`)

| Table                | Key columns                                                                                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roots`              | id, path, label, volume_id (best-effort), status (`ok`/`offline`/`missing`), added_at, last_scan_at                                                                                                                                                                                                                     |
| `exclusions`         | id, root_id, rel_path                                                                                                                                                                                                                                                                                                   |
| `assets`             | id (UUID, stable), root_id, rel_path, filename, ext, kind (`video`/`audio`/`image`/`template`/`other`), size, mtime, fingerprint, width, height, duration_ms, fps, codec, has_alpha, channels, sample_rate, status (`ok`/`missing`/`offline`/`error`), error_msg, favorite, notes, added_at, indexed_at, last_seen_scan |
| `tags`, `asset_tags` | many-to-many                                                                                                                                                                                                                                                                                                            |
| `scans`              | id, root_id, started_at, finished_at, state (`running`/`done`/`aborted`)                                                                                                                                                                                                                                                |
| `assets_fts`         | FTS5 over filename, rel_path, tag names                                                                                                                                                                                                                                                                                 |

- **Fingerprint** = size + mtime + hash of first/last 64 KB → detects a file **moved within a root** (keeps ID, tags, favorite).
- **Missing detection** only happens when a scan finishes (`last_seen_scan < scan.id`). A crashed/aborted scan never marks anything missing.
- **Offline root** (drive unplugged): assets keep their data and show as offline, never deleted; they come back on reconnect.
- **Metadata is never invented.** Fields stay NULL when FFprobe can't read them; the UI shows "—".
- Migrations run in a transaction; the DB file is copied to `library.db.bak` before any migration.

## 4. Media pipeline

- **Thumbnail**: video frame at 10% of duration (≤ 3 s in) / image downscale / audio = waveform tile → WebP 384 px with alpha preserved. Cache key = asset id + fingerprint; deleted cache regenerates lazily.
- **Playback**: if Chromium can play the original (probed with `canPlayType`) it streams via `asset://`. Otherwise an on-demand **VP9 WebM proxy** is generated (yuva420p when alpha) and cached — this covers ProRes, DNx, HEVC-alpha on Windows, AIFF.
- **Waveform**: FFmpeg decodes to low-rate mono PCM → peaks array saved to cache → rendered by wavesurfer.js.
- Jobs are lazy (only for what's on screen or selected), prioritized (selected > visible > background), cancellable, time-limited. Corrupt media → `status=error` + readable message, never a crash.

## 5. UI

Dark, charcoal surfaces, purple accent (`#8B5CF6`, ramp 200–700) + white. Layout: sidebar · top bar
(search, filters, sort, view toggle, rescan) · virtualized grid · details panel (large preview, metadata,
tags, favorite, notes, Reveal, Copy path, drag handle) · status bar (scan/media progress).
Keyboard: arrows, Space = preview, Enter = reveal, Cmd/Ctrl+F = search, F = favorite.
Empty, loading and error states for every view. All brand assets come from `branding/` only.

## 6. Security

contextIsolation + sandbox + nodeIntegration off; strict CSP; no remote content; preload exposes a small
typed API; every IPC payload validated with zod; renderer deals in IDs, never paths; FFmpeg spawned with
argument arrays (no shell); `shell.showItemInFolder` only for indexed paths; symlinks are not followed
outside a root; media files treated as untrusted input.

## 7. Testing

- **Unit (Vitest)**: scanner, fingerprinting, migrations, missing/offline logic, IPC schemas, FTS queries.
- **Integration**: real SQLite + generated fixture media (FFmpeg `testsrc`/`sine`, original, redistributable), including corrupt and zero-byte files.
- **E2E (Playwright `_electron`)**: launch → add fixture root → search → favorite → restart → favorite persists.
- **Manual host tests** (recorded in `docs/compatibility/`): drag-out into Premiere Pro 26.5 and After Effects 26.5 on macOS; Windows when available.
- CI (GitHub Actions): typecheck, lint, unit on every push; dmg + exe artifacts on tags.

## 8. Milestones

| #     | Milestone                                                                                                                      | Done when                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| M1    | **Foundation** — repo, scaffold, tooling, branding module, design tokens, app shell                                            | App launches showing the branded empty shell; typecheck/lint/test pass      |
| M2    | **Packaging spike** — unsigned dmg (arm64 + x64) + NSIS exe that load better-sqlite3 + FFmpeg; drag-out spike into Premiere/AE | Installers build in CI; packaged app opens; a test file drags into Premiere |
| M3    | **Library core** — roots, scanner, DB, metadata, missing/offline, rescan                                                       | Fixture library indexes; unplug/replug and moved-file tests pass            |
| M4    | **Browser UI** — grid/list, search, filters, sort, tags, favorites, details                                                    | E2E flow passes; 50k-asset fixture scrolls smoothly                         |
| M5    | **Media** — thumbnails, proxies, hover-scrub, alpha checkerboard, waveforms                                                    | ProRes 4444 alpha + WAV fixtures preview correctly                          |
| M6    | **v1.0 release** — polish, keyboard nav, install guide (unsigned steps), GitHub Release                                        | Acceptance checklist below is all green                                     |
| Later | Premiere UXP panel (import/insert; panel drag needs Premiere 27+), AE ExtendScript bridge, file watching, collections          | —                                                                           |

## 9. v1 acceptance checklist

Launches · add folders · assets indexed · metadata persisted · thumbnails cached · search · filters ·
favorites persist across restarts · missing/offline handled · rescan detects changes · originals untouched
(checksum test) · logo replaceable from `branding/` · understandable errors · automated tests pass ·
dmg + exe build · install & dev docs · known limitations documented · works offline without an account.

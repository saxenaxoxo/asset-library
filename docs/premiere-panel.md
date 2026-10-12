# Asset Library panel for Premiere Pro

The panel shows the library that the Asset Library desktop app has indexed, right inside Premiere
Pro: search, filter, preview, and put assets on the timeline at the playhead.

**Requirements:** Premiere Pro 25.6 or later (UXP plugins), and the Asset Library desktop app with
at least one folder added. The desktop app does the indexing and makes the previews; the panel reads
them from disk, so the app doesn't need to be running while you edit.

## Install the panel

### Option A: install the packaged panel (`.ccx`)

1. Build it: `pnpm panel:package` (creates `apps/premiere-panel/release/Asset-Library-Premiere-<version>.ccx`).
2. Double-click the `.ccx`. Creative Cloud opens and installs it. It warns that the plugin isn't from
   the Adobe Marketplace; that's expected for now.
3. Restart Premiere Pro and open **Window → UXP Plugins → Asset Library** (on some versions the
   panel is under **Window → Extensions**).

### Option B: load it for development (live reload)

1. Install **UXP Developer Tools** from the Creative Cloud app (All apps).
2. In Premiere Pro: **Settings → Plugins → Enable developer mode**, then restart Premiere.
3. Run `pnpm panel:watch` from the repository root.
4. In UXP Developer Tools: **Add Plugin** → choose `apps/premiere-panel/dist/manifest.json` → **Load**.
   Use **Watch** so changes reload automatically, and **Debug** to see the panel's console.

## Using it

- **Search** matches any part of the name, folder or tags. The chips filter by type or favorites.
- **Hover** over a video to scrub through it. Transparent overlays show over a checkerboard.
- **Select** an asset to see its preview at the bottom.
- **Add at playhead** (or double-click, or press Enter) imports the original file into an
  **Asset Library** bin (once; later uses reuse it) and places it at the playhead.
  - Choose the **video and audio tracks** (V1–V8, A1–A8). Picking a track that doesn't exist yet
    makes Premiere add it.
  - **Overwrite** replaces what's under the playhead; **Insert** pushes later clips to the right.
- **Import** adds it to the bin without touching the timeline.
- `.mogrt` templates are placed directly with Premiere's Motion Graphics template API.
- **Drag onto the timeline** works on Premiere Pro **27.0 and later** (Adobe added panel drag-and-drop
  in 27.0). On earlier versions, use Add at playhead, or drag from the desktop app instead.

## How it finds your library

The desktop app writes `catalog.json`:

- macOS: `~/Library/Application Support/Asset Library/catalog/catalog.json`
- Windows: `%APPDATA%\Asset Library\catalog\catalog.json`

If the panel can't find it, use **Choose catalog…** and pick that file. The panel re-reads it
automatically when the library changes.

## What the panel can and can't do (Premiere's API limits)

- Premiere's API can't tell a panel which track is _targeted_, so you pick tracks in the panel.
- Templates other than `.mogrt` (`.aep`, `.ffx`, `.prproj`) can't be placed from Premiere.
- The panel needs the **Full access** file permission so it can read your asset drives.

# Asset Library panel for Premiere Pro

The panel shows the library that the Asset Library engine has indexed, right inside Premiere Pro:
browse folders, search, preview, organize, and put assets on the timeline, by drag or at the playhead.

**Requirements:** the Asset Library app (it runs as a background engine that does the indexing and
makes the previews), and Premiere Pro **24 or later**.

The panel comes in two builds from the same code, because Premiere's two extension runtimes differ in
what a panel may do:

| Premiere Pro | Build                                                                                  | How it's installed                                            | Where it opens                           |
| :----------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :--------------------------------------- |
| 24 – 26      | **CEP extension** (`apps/premiere-panel/cep`, `pnpm -C apps/premiere-panel build:cep`) | a signed `.zxp`, or the extension folder itself               | **Window → Extensions → Asset Library**  |
| 27 and later | **UXP plugin** (`.ccx`, `pnpm -C apps/premiere-panel package`)                         | Creative Cloud (double-click the `.ccx`) or Adobe's installer | **Window → UXP Plugins → Asset Library** |

Dragging from the panel onto the timeline needs the CEP build on Premiere 24–26 (Premiere reads drags
from UXP panels only from 27.0). Everything else works the same in both.

## Install the panel

### CEP build (Premiere 24–26)

1. Build it: `pnpm -C apps/premiere-panel build:cep` → `apps/premiere-panel/dist-cep/`.
2. For development, copy `dist-cep` to the CEP extensions folder and enable Adobe's debug mode:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.saxenascreation.assetlibrary.cep`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.saxenascreation.assetlibrary.cep`
   - Debug mode (unsigned extensions load): `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
     (also `CSXS.12`), or the `PlayerDebugMode` string value under `HKCU\Software\Adobe\CSXS.11` on Windows.
   - `pnpm -C apps/premiere-panel build:cep -- --debug` adds a `.debug` file; the panel's console is
     then at http://localhost:8092 in a browser.
3. For users, the extension is signed into a `.zxp` (`pnpm -C apps/premiere-panel sign:cep`, which needs
   Adobe's `ZXPSignCmd` in `apps/premiere-panel/tools/`) and bundled into the Asset Library app, which installs
   it through Adobe's installer under the name "Asset Library CEP". The app installs the CEP build where a
   Premiere Pro below 27 is installed and the UXP build where 27 or later is, so nobody gets two panels.
4. Restart Premiere Pro and open **Window → Extensions → Asset Library**.

The Premiere side of the CEP build is `cep/host.jsx`, ExtendScript (ES3) with a semicolon after every
statement: Premiere's engine stops at the first statement without one, and the panel then only sees
"EvalScript error." for everything. A unit test keeps the file formatted that way.

### UXP build (Premiere 27 and later)

1. Build it: `pnpm -C apps/premiere-panel package` (creates `release/Asset-Library-Premiere-<version>.ccx`).
2. Double-click the `.ccx`. Creative Cloud opens and installs it. It warns that the plugin isn't from
   the Adobe Marketplace; that's expected for now. (The Asset Library app also installs it on first launch.)
3. Restart Premiere Pro and open **Window → UXP Plugins → Asset Library**.

For live reload of the UXP build: install **UXP Developer Tools** from the Creative Cloud app, enable
**Settings → Plugins → Enable developer mode** in Premiere, run `pnpm -C apps/premiere-panel watch`,
and in UXP Developer Tools **Add Plugin** → `apps/premiere-panel/dist/manifest.json` → **Load**.

## Using it

- **Search** matches any part of the name, folder or tags, in the open folder or everywhere. The type menu and the ★ narrow the grid.
- **Hover** over a video to scrub through it. Transparent overlays show over a checkerboard.
- **Add at playhead** (or double-click, or press Enter) imports the original file into an
  **Asset Library** bin (once; later uses reuse it) and places it at the playhead.
  - Choose the **video and audio tracks** (V1–V8, A1–A8). Picking a track that doesn't exist yet
    makes Premiere add it.
  - **Overwrite** replaces what's under the playhead; **Insert** pushes later clips to the right.
- **Import** adds it to the bin without touching the timeline.
- `.mogrt` templates are placed directly with Premiere's Motion Graphics template API.
- **Drag onto the timeline** (or the Project panel): any tile or file in the tree. With several
  selected, dragging one of them drags them all. (Premiere 24–26 need the CEP build for this.)
- **Several at once:** Shift-click or Cmd/Ctrl-click tiles, then Enter or **Add N at playhead** places
  them one after another. Arrow keys move the selection, F favorites, Space plays a sound, Esc clears, `/` searches.

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

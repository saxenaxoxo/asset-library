# Hands-on test checklist

Things automated tests can't prove, to check by hand in the real apps. Use a scratch project and
sequence; nothing here changes your files, but drops and inserts do change the open project.
Record ✅ / ❌ (with what happened) next to each line, and copy results into `drag-out.md` and
`premiere-panel.md` in this folder.

## 1. Desktop app (10 min)

- [ ] `pnpm dev` (or install the `.dmg`). Add a real assets folder (ideally on an external drive).
- [ ] Scanning finishes; thumbnails appear; hovering a video scrubs through it.
- [ ] A ProRes 4444 overlay shows **Alpha** and plays in the details panel.
- [ ] Search, type filters, favorites, tags work; favorites survive quitting and reopening.
- [ ] Unplug the drive → its assets show **Drive offline** (not deleted). Plug back in → **Rescan** → normal again.
- [ ] Rename a file in Finder → Rescan → it keeps its favorite and tags.

## 2. Drag from the desktop app into Premiere Pro 26.5 and After Effects 26.5 (5 min)

- [ ] Drag a video, a ProRes overlay, a WAV and a PNG into Premiere's **Project panel**.
- [ ] Drag each onto the **timeline** (with a sequence open).
- [ ] The same into After Effects (Project panel and a comp).
- [ ] Select several and drag them at once (Settings → Drag-out test → Drag all).
- [ ] Drag from the **installed** app too (not only `pnpm dev`): the drag icon appears and the drop works.

## 3. Premiere Pro panel (15 min) — see `docs/premiere-panel.md` to install

- [ ] Panel opens and shows your library (or offers **Choose catalog…**).
- [ ] Thumbnails show. _(If they're blank, note it: UXP image loading is the biggest unknown.)_
- [ ] Hover-scrub works on videos; selected item preview plays.
- [ ] Scroll down the grid and wait while the desktop app is still indexing: the grid stays where you scrolled.
- [ ] Select an audio file: its preview stays silent until you click it.
- [ ] **Add at playhead** with V2/A2 + Overwrite: clip lands at the playhead on V2/A2, inside an
      **Asset Library** bin. Undo (Cmd+Z) removes it in one step.
- [ ] Insert mode pushes later clips right.
- [ ] Moving the playhead, then adding again, uses the _new_ playhead position.
- [ ] Adding the same asset twice doesn't import it twice.
- [ ] A ProRes 4444 overlay keeps its transparency on the timeline.
- [ ] A `.mogrt` (if you have one) is placed at the playhead.
- [ ] Adding while no sequence is open shows "Open a sequence, then try again."
- [ ] Add a folder in the desktop app → the panel updates within a few seconds.
- [ ] The panel's icon shows in Premiere's Window → UXP Plugins menu and in the panel tab.
- [ ] A file with `#` or `%` in its name (e.g. `Glitch #2.mov`) adds correctly.

## 4. After Effects 26.5 (10 min) — from the desktop app's details panel

- [ ] With After Effects closed, **Send to After Effects** says to open it first (it must not launch AE).
- [ ] With a project open: the first time, macOS asks to let Asset Library control After Effects → allow.
- [ ] **Send to After Effects** imports the original into the project.
- [ ] With "Also add to the active comp" ticked: a layer is added at the comp's current time.
- [ ] One **Cmd+Z** undoes it.
- [ ] A ProRes 4444 overlay keeps its transparency.
- [ ] An `.ffx` preset applies to the selected layers ("Apply to selected layers in After Effects").
- [ ] An `.aep` imports as a project.
- [ ] A file with `%` in its name (e.g. `50% Grain.mov`) imports correctly.

## 5. Installers (5 min)

- [ ] Open `Asset-Library-<v>-arm64.dmg`, drag to Applications, open. macOS blocks it the first time →
      **System Settings → Privacy & Security → Open Anyway** works.
- [ ] Double-click the panel `.ccx` → Creative Cloud installs it → it appears in Premiere.

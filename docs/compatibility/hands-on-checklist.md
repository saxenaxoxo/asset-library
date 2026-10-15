# Hands-on test checklist

Things automated tests can't prove, to check by hand in the real apps. Use a scratch project and
sequence; nothing here changes your files, but drops and inserts do change the open project.
Record ✅ / ❌ (with what happened) next to each line, and copy results into `drag-out.md` in this folder
and the "What the panel can and can't do" section of `docs/premiere-panel.md`.

## 1. Library, from the Premiere Pro panel (10 min)

The desktop app's window is now only the Goated Panels Hub installer; folders, search, tags and
favorites live in the panel (install it first, section 3).

- [ ] Install the `.dmg` (Goated Panels Hub). In the panel, add a real assets folder (ideally on an external drive).
- [ ] Scanning finishes; thumbnails appear; hovering a video scrubs through it.
- [ ] A ProRes 4444 overlay shows **Alpha** and plays in the panel's preview.
- [ ] Search, type filters, favorites, tags work; favorites survive quitting and reopening.
- [ ] Unplug the drive → its assets show **Drive offline** (not deleted). Plug back in → **Rescan** → normal again.
- [ ] Rename a file in Finder → Rescan → it keeps its favorite and tags.

## 2. Drag from the desktop app — removed

The desktop asset browser, its drag-out and the drag-out test are gone (decision H6). Dragging
onto the timeline is done from the panel (section 3).

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
- [ ] Add a folder from the panel → it appears and fills in within a few seconds.
- [ ] The panel's icon shows in Premiere's Window → UXP Plugins menu and in the panel tab.
- [ ] A file with `#` or `%` in its name (e.g. `Glitch #2.mov`) adds correctly.

## 4. After Effects — removed

Send to After Effects lived in the old desktop browser and is gone with it. There's no After
Effects panel yet; the Hub's Install screen says so.

## 5. Installers (5 min)

- [ ] Open `Goated-Panels-Hub-<v>-arm64.dmg`, drag to Applications, open. macOS blocks it the first time →
      **System Settings → Privacy & Security → Open Anyway** works.
- [ ] In the Hub, **Install** puts the panel into Premiere; it appears in Premiere as **Asset Library**.

## 6. Windows (only if you have a Windows PC; 15 min)

Get `Goated-Panels-Hub-<v>-setup.exe` from the latest **Build** run on GitHub (Actions → Build → Artifacts → `asset-library-windows`).

- [ ] Run the installer. On SmartScreen's "Windows protected your PC" click **More info → Run anyway**. Desktop and Start menu shortcuts appear.
- [ ] Add a folder (try one on an external drive and, if you use one, a network share like `\\NAS\Assets`). Thumbnails, hover-scrub and previews appear.
- [ ] Install the panel from the Hub and repeat the panel checks from section 3; the panel finds the library on its own.
- [ ] Uninstall from Settings → Apps: the app goes, and your asset files are untouched.

## 7. Upgrading from Asset Library to Goated Panels Hub (decision I2; 20 min per computer)

Start from a computer with the **old** Asset Library app installed, a library with favorites and
tags, the panel installed and start-at-login on. None of this has been tried on a real computer yet.

macOS:

- [ ] With the old app running, open Goated Panels Hub: it asks the old one to quit (or says to quit it), then opens with your library, favorites and tags.
- [ ] `~/Library/Application Support/Goated Panels Hub` holds the library; `…/Asset Library` is now a link to it.
- [ ] The old `Asset Library.app` is in the Trash (not deleted); Goated Panels Hub stays in Applications.
- [ ] The panel installed **before** the upgrade still shows the library (through the link), before and after restarting Premiere.
- [ ] After a restart, Goated Panels Hub (not the old app) starts at login.
- [ ] Clicking **Start** in the panel with the Hub quit opens Goated Panels Hub (`assetlibrary://`).

Windows:

- [ ] Run `Goated-Panels-Hub-<v>-setup.exe` over the old install: no "Asset Library" left in the Start menu, desktop shortcuts or Settings → Apps; one "Goated Panels Hub" entry.
- [ ] It installs to `…\Programs\Goated Panels Hub`; the old `…\Programs\Asset Library` folder is gone.
- [ ] First launch: library, favorites and tags are there; `%APPDATA%\Asset Library` is a junction to `%APPDATA%\Goated Panels Hub`.
- [ ] With the old app running during the first launch, it's closed (or you're told to quit it) and nothing is lost.
- [ ] The panel installed before the upgrade still shows the library.
- [ ] After a restart, Goated Panels Hub starts at login (in the background).
- [ ] The panel's **Start** opens Goated Panels Hub.
- [ ] Uninstall from Settings → Apps, choosing to keep the library: the app and panel go, the library stays. Reinstall: it's back.

Move failures (either computer; use a copy of the library):

- [ ] With a file in the old data folder held open by another program (Windows), the Hub still opens on the old folder and moves it on a later launch.

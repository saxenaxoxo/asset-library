# Changelog

## 0.1.1 (Mac), panel 0.4.2

- Fixed: adding a library folder from the Premiere panel failed with "its location wasn't complete" when the folder's path contained spaces or other special characters. Adobe's folder picker reports such folders as a `file://` address; the panel and the app now turn it into a normal path. Importing files had the same problem and is fixed too.

## Unreleased

### Clearer that the Hub is the engine, and fixes

- Goated Panels Hub now says plainly that it is the engine the Asset Library panel needs and keeps running in the background: a status line at the top of its window, a **Background engine** section in Manage with a **Start Goated Panels Hub when I log in** switch (on by default), next steps after installing, a fifth step in Help, a clearer menu-bar menu and tooltip, and a one-time note the first time you close the window. **Close** is now **Close window**.
- Quitting from the menu-bar menu or with Cmd+Q now asks first, because the panel stops updating without the Hub.
- The Premiere panel shows a banner with a **Start Goated Panels Hub** button when the Hub isn't running, and its Settings explain what the Hub does.
- Fixed: the panel could start an old copy of the app (a test build or one on the disk image) instead of the one in Applications. Only the installed copy now registers itself for the panel and for start at login; other copies hand over to it.
- Fixed: importing more than 500 files at once failed; big imports now go in several parts.
- Fixed: requests sent while the Hub was still starting could be cancelled with "isn't running" even though it was on its way. The panel now waits up to a minute after starting it.
- Fixed: adding the same folder twice (once with a trailing slash, or as a `file://` address) indexed it twice.
- Fixed: network-share folders (`file://server/share`) and folder names with a stray "%" weren't read correctly.
- Fixed: a downloads folder that couldn't be written to crashed the Hub; a download server that never answered left the install hanging; and two installs at once (menu bar and window) could install the older panel and report the wrong result.
- Fixed: the uninstall dialog named the wrong thing ("the Goated Panels Hub panel"); deleting your library left a broken "Asset Library" link behind on macOS; and on Windows the uninstaller asked again whether to delete the library.
- Fixed: a data-folder move that didn't finish could switch start at login off.
- The UXP panel may now open web links (the "Get it" update link).

### Panel downloads

- Goated Panels Hub can now download a newer Premiere Pro panel instead of waiting for a new Hub release. It reads a small download list from the project's GitHub Releases, downloads the panel file, checks its size and SHA-256 fingerprint, and only then installs it with Adobe's plug-in installer. A file that doesn't match is deleted and nothing is installed.
- The panel built into the Hub stays as the fallback: it's used offline, when the download list can't be read, or when the list has nothing newer.
- Install and Manage show where each panel comes from and its download size, real download progress (Downloading n%, with the bytes so far) with a Cancel button, then Verifying and Installing. Manage shows **Update available** as soon as the download list has a newer panel. Being offline is shown plainly.
- Network use: besides the optional daily update check, the Hub contacts GitHub only when you open its window or install a panel. No account, cookies or identifiers are sent, and only this project's GitHub release files are allowed.
- For maintainers: `pnpm panels:release` builds and signs both panels and writes the download list; publishing is described in `docs/releasing-panels.md`.

### Goated Panels

- Asset Library is now made by **Goated Panels**. The desktop window is called **Goated Panels Hub** and wears the new Goated Panels mark and app icon; the Premiere panel's About line reads "by Goated Panels".
- The app is now called **Goated Panels Hub** on your computer too: in Applications, the Start menu, Settings → Apps and its installers. The first time it opens it moves your library, settings and thumbnails from the old "Asset Library" data folder (one rename, nothing copied or deleted) and leaves a link under the old name so older Premiere panels still find the catalog. A copy of the old app that's still running is closed first.
- Updating replaces the old app: on Windows the installer removes the old install and its shortcuts and installs under the new name; on macOS the old Asset Library.app goes to the Trash. Start at login carries over. The `assetlibrary://` link, the panel IDs and the panel's name in Premiere don't change.
- The copyright holder, Windows publisher and the CEP panel's signing certificate are now Goated Panels.
- Brand names, logos (mark, wordmark, one-colour versions, Asset Library attribution) and their rules live in `packages/branding/`. A model for describing products to a future website is documented in `docs/product/product-metadata.md` (not built).

### The app is now the installer

- Opening Asset Library shows an installer and manager instead of the asset browser (browsing lives in the Premiere panel). **Install** finds each Premiere Pro version through Adobe's own plug-in installer, recommends CEP (2024–2026) or UXP (2027 and later) with the reason, and lets you choose the other with a warning. **Manage** lists every installed copy with its Premiere versions and offers update and uninstall. **About** and **Help** cover the rest.
- The panel is no longer installed silently on first launch; you install it from the window. Installed panels still update themselves when a new app version brings a newer one.
- After Effects is shown as not available yet: there's no After Effects panel to install.
- Drag-out and Send to After Effects, which lived in the old browser window, are gone with it.
- The window can now reach only the installer's own commands: the old browser's commands (folders, search, tags, favorites, drag-out, Send to After Effects) are removed from the app, and macOS no longer asks to let Asset Library control After Effects.

### Uninstall

- "Uninstall Asset Library…" in the Premiere panel's Settings, the menu-bar icon and the macOS app menu: removes the Premiere Pro panel, the login item and the app, and optionally the library. Your own files are never touched.
- Uninstalling from Windows Settings → Apps also removes the Premiere Pro panel and asks whether to delete the library.

### Premiere Pro panel 0.3.21 – 0.4.0

- A CEP build of the panel for Premiere Pro 24–26, from the same code as the UXP build: drag assets onto the timeline, double-click or "Add at playhead" to place them. The app installs whichever build each installed Premiere needs.
- Folder tree clickable in Premiere; counts stay clear of the scrollbar.
- Multi-select (shift and cmd/ctrl), keyboard navigation, sound preview, type filter, search scope, Recent, and a thumbnail size menu.
- The panel reads catalog changes instead of reloading the whole catalog.

### Tested in Premiere Pro 26 and After Effects 26 (macOS)

- Send to After Effects works: it failed in the real app with error -1708 because After Effects' "DoScriptFile" command can't be named when the app is chosen at run time; it now uses the command's raw code.
- Premiere panel previews: Premiere's panel runtime can't play video (`play()` fails inside the host) and draws video over the panel, hiding audio waveforms. The selected video now plays as a flipbook of its scrub frames, and audio shows its waveform.
- Premiere panel layout: video track, audio track and edit type sit on one line in equal columns, with "Add at playhead" and "Import" below.
- Confirmed working in the hosts: panel install with Adobe's installer, thumbnails and waveforms, hover-scrub, search, overwrite and insert at the current playhead on chosen tracks, one-step undo, no duplicate imports, `#` and `%` in file names, transparency, drag from the app into Premiere's timeline and After Effects' project, and Send to After Effects with one-step undo.

### Windows

- Every build now installs the Windows app with the real installer, tests the installed app, and uninstalls it again.
- Unit tests and the Premiere panel tests also run on Windows; paths with drive letters and network shares (`\\NAS\share`) are covered.
- Windows FFmpeg is pinned to one checked build (FFmpeg 9.0.2) instead of whatever was newest.
- No stray menu bar on Windows; the macOS menu is the app's own (Electron's default linked to Electron and opened developer tools).
- "Show in Explorer" on Windows; After Effects is found wherever Program Files lives.
- Both installers include the third-party notices, with the FFmpeg license details.

### Reliability and speed pass

- Drag-out works in the installed app (the drag icon is now packaged); a test guards it.
- Faster indexing of large libraries: the search index no longer rescans itself for every new file.
- Searches like "clip 02" now use the short word too.
- Removing a folder while it's scanning, or a background worker crash, no longer causes errors or wrongly flags files.
- A folder that can't be fully read no longer marks its files as missing.
- Files that change during processing are re-processed instead of keeping stale details or thumbnails.
- Old cached thumbnails and previews are cleaned up automatically.
- Hover-scrub strips for long clips are generated by seeking (about 20× faster on a 2-minute 1080p clip).
- The Premiere panel catalog is rebuilt in one pass and written safely, at most every few seconds while indexing.
- A damaged or newer library database shows a message instead of a silent hang at launch.
- Send to After Effects picks the After Effects version that's open, and handles `%` in file names.
- Installers no longer carry other platforms' database binaries.
- Desktop app: details panel stays open while you move through assets; arrow keys move by row in the grid; Enter no longer fires through buttons; fewer re-renders; keyboard access for the list view and folder removal.
- Premiere panel: hover-scrub follows the cursor; the grid keeps its scroll and open menus while the catalog updates; tiles are reused instead of rebuilt; memory for loaded images is capped; Enter on a menu no longer places a clip; file names with `#`, `?` or `%` and network-share paths work; `.mogrt` failures are reported; panel and plugin icons ship as PNGs; audio previews play only when clicked.

### Milestone 1: Foundation

- Electron 44 + React 19 + TypeScript + Tailwind 4 app scaffold (electron-vite, electron-builder).
- Secure by default: sandboxed renderer, context isolation, strict CSP, a typed preload bridge with one method per channel, zod-validated IPC with sender checks, all permission requests denied, navigation and new windows blocked.
- Replaceable branding module (`packages/branding/`) with a placeholder logo, app icon and purple accent theme.
- App shell: sidebar, search and sort bar, first-run screen with "Add folder", status bar.
- Unit tests (Vitest) and an end-to-end launch test (Playwright + Electron).
- Developer tooling: formatting, linting and tests run automatically; repository layout with `apps/` and `packages/`.

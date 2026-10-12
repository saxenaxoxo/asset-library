# Drag-out compatibility

How dragging files out of Asset Library behaves in each host app. The app starts a native OS file
drag (Electron `webContents.startDrag`), the same as dragging from Finder or Explorer. Original files
are referenced in place; nothing is copied.

**How to test** (takes about 5 minutes; do it when you're not mid-edit):

1. Run the app (`pnpm dev`), open **Settings** in the sidebar, then **Choose test files**.
2. Pick one of each: an H.264 `.mp4`, a ProRes `.mov` (ideally ProRes 4444 with alpha), a `.wav`, a `.png`.
3. Drag each one into the host targets below, then try **Drag all** for a multi-file drop.
4. Fill in the table: ✅ works · ❌ fails (note what happened) · — not tried.

## Premiere Pro 26.5.2 (macOS, Apple Silicon)

| File                  | Project panel | Timeline (open sequence) | Timeline (no sequence) | Notes |
| --------------------- | ------------- | ------------------------ | ---------------------- | ----- |
| .mp4 (H.264)          |               |                          |                        |       |
| .mov (ProRes / alpha) |               |                          |                        |       |
| .wav                  |               |                          |                        |       |
| .png                  |               |                          |                        |       |
| Several at once       |               |                          |                        |       |

## After Effects 26.5.0 (macOS, Apple Silicon)

| File                  | Project panel | Composition / timeline | Notes |
| --------------------- | ------------- | ---------------------- | ----- |
| .mp4 (H.264)          |               |                        |       |
| .mov (ProRes / alpha) |               |                        |       |
| .wav                  |               |                        |       |
| .png                  |               |                        |       |
| Several at once       |               |                        |       |

## Windows

Not tested yet (needs a Windows machine). Known risk: drops fail if Premiere/After Effects runs
**as administrator** while Asset Library doesn't, because Windows blocks drag-and-drop between privilege levels.

## What the docs say (researched 2026-10-11)

- Premiere Pro officially accepts files dragged from Finder/Explorer into the Project panel and onto the timeline.
- After Effects drops into the Project panel are only documented by third parties.
- A `.mogrt` dropped on Premiere's Project panel is _installed_ into Essential Graphics rather than added as a clip.

<p align="center">
  <img src="branding/assets/logo-mark.svg" width="72" alt="Asset Library logo" />
</p>

<h1 align="center">Asset Library</h1>
<p align="center">by Saxenas Creation</p>

A free desktop asset manager for video editors and motion designers. Point it at your folders and
external drives, and it indexes your transitions, overlays, sound effects, music, footage and images.
You can then search, preview, tag and favorite them, and drag the original files straight into
Premiere Pro, After Effects or any other app.

- **Local and private.** No account, no cloud, no telemetry. Works offline.
- **Your files stay put.** Asset Library never moves, renames, changes or deletes your files.
- **macOS and Windows.** Apple Silicon, Intel and Windows x64.

> **Status:** early development (Milestone 1 of 6). Not ready for use yet. See
> [docs/product/v1-spec.md](docs/product/v1-spec.md) for the plan.

## Install (once releases exist)

The installers are not code-signed, so your OS will warn you the first time:

- **macOS:** open the `.dmg`, drag Asset Library to Applications, and open it. When macOS blocks it,
  go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** run the `-setup.exe`. On the SmartScreen warning click **More info → Run anyway**.

## Develop

Requires Node 22+ and pnpm 11. Run commands from the repository root.

```bash
pnpm install
pnpm dev          # run with hot reload
pnpm check        # typecheck + lint + unit tests
pnpm test:e2e     # launch the built app with Playwright
pnpm dist:mac     # unsigned .dmg into apps/desktop/dist/  (pnpm dist:win for the .exe)
```

## Project map

| Path                   | What                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `apps/desktop/`        | The desktop app and library engine (Electron, React, SQLite, FFmpeg)            |
| `apps/premiere-panel/` | The Premiere Pro panel (UXP), coming next                                       |
| `packages/branding/`   | Logo, app icon, name and colours. See its [README](packages/branding/README.md) |
| `docs/product/`        | Product spec and decisions log                                                  |
| `docs/compatibility/`  | What works in each host app, with test results                                  |
| `.github/workflows/`   | Automated checks and installer builds for macOS and Windows                     |

## License

Copyright © 2026 Saxenas Creation. All rights reserved. Asset Library is free to download and use,
but the source code is not open source. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

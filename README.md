<p align="center">
  <img src="packages/branding/assets/logo-mark.svg" width="72" alt="Asset Library logo" />
</p>

<h1 align="center">Asset Library</h1>
<p align="center">by Saxenas Creation</p>

A free alternative to Premiere Composer for your **own** assets. Point Asset Library at your folders
and external drives, and it indexes your transitions, overlays, sound effects, music, footage and
images. Browse and preview them in a **panel inside Premiere Pro** and place them at the playhead, or
use the desktop app to search, tag, favorite, and drag originals into Premiere Pro, After Effects or
any other app.

- **Local and private.** No account, no cloud, no telemetry. Works offline.
- **Your files stay put.** Asset Library never moves, renames, changes or deletes your files.
- **macOS and Windows.** Apple Silicon, Intel and Windows x64.

> **Status:** in development, not released yet. The desktop library and the Premiere Pro panel work;
> hands-on testing in Premiere is under way. See [docs/product/v1-spec.md](docs/product/v1-spec.md).

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
pnpm panel:watch  # build the Premiere panel and rebuild on change
pnpm panel:package  # UXP plugin (.ccx, Premiere 27+) into apps/premiere-panel/release/
pnpm panel:sign:cep # signed CEP extension (.zxp, Premiere 24–26); needs Adobe's ZXPSignCmd
```

`pnpm dist:mac` bundles whichever panel files are in `apps/premiere-panel/release/`, so run
`pnpm panel:sign:cep` first to ship the CEP build too. See [docs/premiere-panel.md](docs/premiere-panel.md).

## Project map

| Path                     | What                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `apps/desktop/`          | The desktop app and library engine (Electron, React, SQLite, FFmpeg)                            |
| `apps/premiere-panel/`   | The Premiere Pro panel: one codebase, a CEP build (24–26) and a UXP build (27+)                 |
| `packages/branding/`     | Logo, app icon, name and colours. See its [README](packages/branding/README.md)                 |
| `packages/catalog/`      | Catalog format shared by the engine and the panel. See its [README](packages/catalog/README.md) |
| `docs/premiere-panel.md` | Building, installing and debugging the Premiere Pro panel                                       |
| `docs/product/`          | Product spec and decisions log                                                                  |
| `docs/compatibility/`    | What works in each host app, with test results                                                  |
| `.github/workflows/`     | Automated checks and installer builds for macOS and Windows                                     |

The folders in `packages/` are plain source folders, not installable packages: the apps import them
through the `@brand/*` and `@catalog/*` path aliases set in each app's `tsconfig` and build config, so
they have no `package.json` and aren't listed in `pnpm-workspace.yaml`.

## License

Copyright © 2026 Saxenas Creation. All rights reserved. Asset Library is free to download and use,
but the source code is not open source. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

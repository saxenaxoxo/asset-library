# Contributing to Asset Library

Thanks for helping. Bug reports, ideas and pull requests are all welcome. By taking part you agree to
follow the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing code, you agree that it's released
under the project's [MIT License](LICENSE).

## Reporting a bug

Open an [issue](https://github.com/saxenaxoxo/asset-library/issues) with:

- what you did, what you expected, and what happened instead;
- the Goated Panels Hub and panel versions (Hub → **About**), your macOS version and your Premiere Pro
  version;
- the file type involved, if it's about a specific asset (a codec name helps, the file itself usually
  isn't needed).

Security problems go through [SECURITY.md](SECURITY.md) instead, not a public issue.

## Setting up

You need macOS, Node 22 or later and pnpm 11. Run everything from the repository root.

```bash
pnpm install
pnpm dev        # the app with hot reload
pnpm panel:watch  # the Premiere panel, rebuilt on change
```

Thumbnails and previews need the bundled LGPL FFmpeg. Build it once with
`apps/desktop/scripts/ffmpeg/build-macos.sh arm64` (or `x86_64`). See [docs/premiere-panel.md](docs/premiere-panel.md)
for loading the panel into Premiere Pro.

## Before you open a pull request

```bash
pnpm check      # typecheck, lint and unit tests: must pass
pnpm test:e2e   # launches the real app: run it for any change to the window, menus or engine
```

- Keep a pull request to one change, and describe what it does and how you checked it.
- Add or update tests for behaviour you change. Never delete or skip a test to make it pass.
- For changes to the window or panel, attach a screenshot.
- Run `pnpm format` so the code matches the project's Prettier style.

## Project rules

These keep the app safe for people's media libraries. Pull requests that break them can't be merged.

- **Never touch the user's files.** The app never moves, renames, changes or deletes them, and never
  writes files into their folders. All state lives in the app's data folder.
- **No telemetry and no accounts.** The only network call is the optional update check on GitHub. Any
  new network use needs discussion in an issue first.
- **Licences.** Every new dependency must be MIT-compatible (MIT, BSD, ISC, Apache-2.0 and similar).
  No GPL or AGPL code. FFmpeg must stay an LGPL build, run as a separate program. Add every shipped
  dependency to [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **Security settings stay as they are:** the window keeps `sandbox`, `contextIsolation` and its content
  security policy, and loads no remote content.
- **IPC:** every channel has a name in `src/shared/channels.ts`, zod schemas in `src/shared/schemas.ts`, a
  typed method in `src/shared/api.ts` and `src/preload/index.ts`, and a handler registered with `handle()`
  in `src/main/ipc/`. The window refers to assets by ID, never by file path.
- **Branding** (names, logos, colours) comes only from `packages/branding/`.
- **Database migrations are append-only.** Never edit one that's already merged; add a new one.

## Questions

Open an issue with the "question" label, or start a discussion on the pull request.

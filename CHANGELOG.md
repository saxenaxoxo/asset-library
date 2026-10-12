# Changelog

## Unreleased

### Milestone 1: Foundation

- Electron 44 + React 19 + TypeScript + Tailwind 4 app scaffold (electron-vite, electron-builder).
- Secure by default: sandboxed renderer, context isolation, strict CSP, a typed preload bridge with one method per channel, zod-validated IPC with sender checks, all permission requests denied, navigation and new windows blocked.
- Replaceable branding module (`branding/`) with a placeholder logo, app icon and purple accent theme.
- App shell: sidebar, search and sort bar, first-run screen with "Add folder", status bar.
- Unit tests (Vitest) and an end-to-end launch test (Playwright + Electron).
- Developer tooling: formatting, linting and tests run automatically; repository layout with `apps/` and `packages/`.

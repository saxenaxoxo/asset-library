# Branding

Everything that makes the apps look like Goated Panels and Asset Library lives in this folder.
Business logic never references these files directly, so the brand can be replaced without touching
the app.

## Names

| Name                  | What it is                                                   | Where it shows                                          |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| **Goated Panels**     | The parent brand that publishes the panels                   | Endorser line ("by Goated Panels"), the hub's mark      |
| **Goated Panels Hub** | The desktop app: installer, manager and background engine    | OS app name, installers, window, menu-bar item          |
| **Asset Library**     | The product: the Premiere Pro panel and its library          | Install screen, Premiere panel and bin, Adobe installer |
| `goatedpanels.in`     | Attribution text only, in "Asset Library by goatedpanels.in" | About screen, product listings. Used sparingly          |

The domain `goatedpanels.in` is **not registered**. `brandDomainStatus` is `'unconfirmed'`, and until it
says `'confirmed'` nothing may link to it, fetch from it, check for updates on it or build a URL out of
it. Links that work today (repository, issues) are in `brand-links.ts`; a unit test checks that none of
them uses the domain.

**Goated Panels Hub** is also the app's operating-system name (`productName`), so it names the
installed app, its data folder and its installers. The app was called Asset Library before and moves
its data folder over on first launch. The Premiere panel keeps the product's name in Adobe's installer.
Persistent IDs (appId, `assetlibrary://`, panel IDs) didn't change. See decisions I1 and I2 in
[docs/product/decisions.md](../../docs/product/decisions.md).

## Files

| File                | What it is                                                   | Used for                                                                |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `brand-identity.ts` | The names above as plain text (no logo imports)              | Main process and the Premiere panel (via `@brand/brand-identity`)       |
| `brand-config.ts`   | Names plus tagline, monograms, logo files and accent colours | Every window component (via `@brand/brand-config`)                      |
| `brand-links.ts`    | Repository and support links (only real, configured URLs)    | `brand-config.ts` and the app's main process (via `@brand/brand-links`) |

### Assets

| File                                                               | What it is                                                                                 | Used for                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `assets/app-icon.svg`                                              | Goated Panels Hub app icon on the 1024 grid                                                | Source for the desktop app icon (`pnpm icons`)       |
| `assets/goated-panels-mark.svg`                                    | Goated Panels mark (64×64): a panel layout with one lit tile; colour, for dark backgrounds | Hub header and About screen                          |
| `assets/goated-panels-mark-mono-on-light.svg`                      | The mark in charcoal, one colour                                                           | Light backgrounds, print, single-colour uses         |
| `assets/goated-panels-mark-mono-on-dark.svg`                       | The mark in off-white, one colour                                                          | Dark backgrounds where colour isn't wanted           |
| `assets/goated-panels-app-icon.svg`                                | The mark on a near-black rounded tile with a soft glow (1024×1024)                         | Website favicon; source for a Goated Panels app icon |
| `assets/goated-panels-wordmark.svg`                                | Horizontal mark + "Goated Panels", colour, for dark backgrounds                            | Docs, a future website header                        |
| `assets/goated-panels-wordmark-mono-on-light.svg` / `-on-dark.svg` | The wordmark in one colour                                                                 | Light / dark backgrounds                             |
| `assets/logo-mark.svg`                                             | Asset Library's square mark (64×64), "Shelf & waveform"                                    | Install screen, README, menu-bar/tray icon           |
| `assets/asset-library-icon.svg`                                    | Asset Library's product icon on the 1024 grid                                              | Product listings (not the desktop app icon)          |
| `assets/asset-library-attribution.svg`                             | Asset Library mark + name + "by goatedpanels.in"                                           | Product listings and docs                            |

## Look

Flat shapes only: no 3D, gradients, shadows or glows.

| Role      | Colour    | Notes                                                |
| --------- | --------- | ---------------------------------------------------- |
| Charcoal  | `#17161C` | Mark details, one-colour mark on light backgrounds   |
| Surface   | `#1A1F10` | Selected rows and highlights (`accentSurface`)       |
| Lime      | `#C6FF3D` | Accent (`accent.500`): the horns, the primary button |
| On lime   | `#0B0B0D` | Text and icons on the accent (`onAccent`)            |
| Off-white | `#F4F2EE` | Text and the mark's panel on dark backgrounds        |

The wordmarks set their text in Geist (bundled with the app) with system fallbacks, so they render
slightly differently where Geist isn't installed. Convert the text to outlines before print or press
use. All artwork is a placeholder made for this project: original work, no third-party marks.

## Replacing the logo

1. Replace the files in `assets/`, keeping the same file names. Square artwork works best for the marks
   and icons; transparent backgrounds are fine.
2. Run `pnpm icons` (from the repository root) to regenerate `apps/desktop/build/icon.png` (from
   `app-icon.svg`) and the menu-bar/tray icons (from `logo-mark.svg`).
3. If the colours change too, edit `colors` in `brand-config.ts`. The whole UI picks them up.

If an image fails to load, the UI shows the monogram (`GP` for the hub, `AL` for the product) on an
accent tile instead of a broken image.

## Also update when renaming the product

`productName` in `apps/desktop/package.json` and `apps/desktop/electron-builder.yml` must equal
`hubName`: installers and the macOS menu bar read them before any app code runs. Changing it moves the
app's data folder, so it needs a migration like the one in decision I2 (`ENGINE_DATA_FOLDERS` in
`packages/catalog/types.ts` lists the folder names the Premiere panel checks).

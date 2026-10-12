# Branding

Everything that makes Asset Library look like Asset Library lives in this folder. Business logic never
references these files directly, so the brand can be replaced without touching the app.

| File                   | What it is                                                                   | Used for                                                               |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `brand-config.ts`      | Product name, attribution, tagline, monogram fallback, accent colours, links | Every UI component (via `@brand/brand-config`)                         |
| `assets/logo-mark.svg` | Square mark (64×64 viewBox)                                                  | Sidebar, about box, empty states                                       |
| `assets/app-icon.svg`  | App icon artwork on the 1024 grid                                            | Source for the desktop app icon (`.icns`/`.ico` are generated from it) |

## Replacing the logo

1. Replace `assets/logo-mark.svg` and `assets/app-icon.svg`, keeping the same file names.
   Square artwork works best; transparent backgrounds are fine.
2. Run `pnpm icons` (from the repository root) to regenerate `apps/desktop/build/icon.png`.
3. If the colours change too, edit `colors` in `brand-config.ts`. The whole UI picks them up.

If an image fails to load, the UI shows `monogram` on an accent tile instead of a broken image.

## Also update when renaming the product

`productName` in `apps/desktop/package.json` and `apps/desktop/electron-builder.yml`. Installers and the
macOS menu bar read those, because they're needed before any app code runs.

Current artwork is a **placeholder** ("Shelf & waveform", variant B). Original work, no third-party marks.

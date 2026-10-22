# Product metadata model (documented, not built)

A description of each Goated Panels product that a future distribution website, or the Goated Panels
Hub, could read to list products and offer the right download. **Not built as described here**: there is
no website, API, feed or download server, and `goatedpanels.in` is not registered. What exists today is
the narrower panel download list (decision I4, `docs/releasing-panels.md`): the Hub reads
`panels-manifest.json` from the `panels` GitHub Release when its window opens or a panel is installed, and the optional update
check reads GitHub Releases (`apps/desktop/src/main/engine/update-check.ts`). Those are the only network
calls.

## Fields

| Field           | Type                                                | Meaning                                                         | Asset Library today (source)                                                                                |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`            | string, stable                                      | Never changes once published                                    | `asset-library` (desktop package name)                                                                      |
| `name`          | string                                              | Display name                                                    | `brandIdentity.primaryProductName`                                                                          |
| `description`   | string                                              | One or two plain sentences                                      | `brand.tagline`, README intro                                                                               |
| `icon`          | path to SVG                                         | Product icon                                                    | `packages/branding/assets/asset-library-icon.svg`                                                           |
| `version`       | semver string                                       | The current release                                             | `apps/desktop/package.json` `version`; panel builds: `InstallerStatus.bundled`                              |
| `os`            | `('macos-arm64' \| 'macos-x64' \| 'windows-x64')[]` | Platforms with an installer                                     | `electron-builder.yml` targets                                                                              |
| `hosts`         | `{ app, build, minVersion, maxVersion? }[]`         | Adobe apps it runs in, per panel build                          | `apps/desktop/src/shared/installer.ts` (`PANEL_BUILDS`, `CEP_FROM_MAJOR`, `UXP_MIN_VERSION`)                |
| `compatibility` | `{ host, version, fit, reason }[]`                  | Per host version: recommended, limited, untested or unsupported | `buildFit()` in the same file; tested versions in `docs/compatibility/`                                     |
| `packages`      | `{ os, file, size, sha256 }[]`                      | Installer files and their checksums                             | GitHub release assets (`Goated-Panels-Hub-<version>-<arch>.dmg`, `-setup.exe`). Checksums not published yet |
| `channel`       | `'stable' \| 'beta'`                                | Release track                                                   | Not used yet (releases are drafts)                                                                          |
| `update`        | `{ version, url, publishedAt }`                     | Latest release and where to read about it                       | GitHub `releases/latest` (`tag_name`, `html_url`) as read by `update-check.ts`                              |
| `attribution`   | string                                              | Secondary credit line                                           | `brandIdentity.productAttribution`                                                                          |
| `status`        | `'available' \| 'in-development' \| 'planned'`      | Whether it can be downloaded                                    | `in-development` (README status)                                                                            |

Rules for whoever builds this:

- Generate the metadata from the sources in the last column at release time, so it can't drift from
  the app. Don't hand-edit a second copy.
- Never invent values: unknown fields are `null` (for example `sha256` until checksums are published).
- `url` fields point at locations that actually exist when the metadata is published. The domain can be
  used only after it's registered and `brandDomainStatus` in `brand-identity.ts` is `'confirmed'`.
- List only products that exist. Planned products don't get placeholder entries.

## Where the Hub could use it later

- **Install screen:** the product card already shows name, mark and panel version from the branding
  module and `InstallerStatus`; a second product would be one more entry, not new code paths.
- **Update check:** `update-check.ts` could read `update` from the metadata instead of GitHub's API, once
  a real, owned endpoint exists. Until then GitHub (the update check and the panel download list) is
  the only place the Hub contacts.

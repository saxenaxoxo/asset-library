# Releasing a Premiere Pro panel for download

Goated Panels Hub can download a newer panel instead of waiting for a new Hub release. It reads a
small **download list** (the manifest, `panels-manifest.json`) and downloads the panel file it names,
checks the file's size and SHA-256 fingerprint, and only then installs it through Adobe's own plug-in
installer. A file that doesn't match is deleted and nothing is installed.

Everything lives on one GitHub Release of `saxenaxoxo/asset-library` with the tag **`panels`**. It's
marked as a pre-release, so the Hub's own update check (which reads the latest normal release) never
mistakes it for a new app version. Its assets are replaced each time a panel is released.

The Hub still carries a copy of each panel. It uses that copy when it's offline, when the download list
can't be read, or when the download list has nothing newer. Products added later are download-only.

## When to do this

Whenever the panel's version (`apps/premiere-panel/package.json`) goes up and you want people to get it
without installing a new Hub. Editors see **Update available** under **Manage** the next time they open
the Hub window.

## Steps

1. Raise the panel version in `apps/premiere-panel/package.json` and commit as usual.
2. Build, sign and describe the panel files (needs ZXPSignCmd in `apps/premiere-panel/tools/`, as for
   any release with the CEP panel):

   ```bash
   pnpm panels:release
   ```

   This writes `release/panels/` (not committed): the UXP `.ccx`, the signed CEP `.zxp`,
   `panels-manifest.json` and `SHA256SUMS-panels.txt`, and prints the exact publish commands.
   Add `-- --no-build` to reuse files already in `apps/premiere-panel/release/`.

3. Publish. Run the printed commands from the repository root. For panel 0.4.1 they are:

   ```bash
   gh release view panels --repo saxenaxoxo/asset-library >/dev/null 2>&1 || gh release create panels --repo saxenaxoxo/asset-library --prerelease --title "Premiere Pro panels" --notes "Panel files that Goated Panels Hub downloads. Not an app release."
   gh release upload panels release/panels/Asset-Library-Premiere-CEP-0.4.1.zxp release/panels/Asset-Library-Premiere-0.4.1.ccx release/panels/SHA256SUMS-panels.txt --repo saxenaxoxo/asset-library --clobber
   gh release upload panels release/panels/panels-manifest.json --repo saxenaxoxo/asset-library --clobber
   ```

   The panel files go up before the manifest, so the manifest never names a file that isn't there yet.

4. Check: open the Hub (on a computer with an older panel installed). **Manage** shows
   **Update available**, and **Update** downloads, verifies and installs it.

The first time, the `gh release create` line makes the `panels` release (and its tag on `main`).
After that it does nothing and only the uploads run. Old panel files can stay on the release; the Hub
only ever reads the files the current manifest names.

## The manifest

```json
{
  "schema": 1,
  "generatedAt": "2026-10-16T00:00:00.000Z",
  "panels": [
    {
      "product": "asset-library",
      "name": "Asset Library",
      "build": "cep",
      "version": "0.4.1",
      "premiere": { "min": "22.0", "below": null },
      "url": "https://github.com/saxenaxoxo/asset-library/releases/download/panels/Asset-Library-Premiere-CEP-0.4.1.zxp",
      "size": 43837,
      "sha256": "7100eb5e…"
    }
  ]
}
```

- `schema`: the format version. A Hub that finds a newer one says it needs updating and uses its own copy.
- `build`: `cep` (Premiere Pro 2024–2026) or `uxp` (2027 and later).
- `premiere`: the Premiere Pro versions that load the file, from the panel's own manifest (`below: null`
  means no upper limit). Which build to recommend stays the Hub's decision.
- `size` and `sha256` must match the file exactly, or the Hub refuses it.
- `url` must be an HTTPS release asset of this repository. The Hub ignores entries pointing anywhere else.

The script writes all of this; don't edit the manifest by hand.

## Moving to downloads.goatedpanels.in later

The manifest address and the list of allowed download hosts are in one place:
`apps/desktop/src/main/security-rules.ts` (`PANEL_MANIFEST_URL`, `DOWNLOAD_URL_PREFIXES`). Moving means
changing those two, updating `BASE_URL` in `apps/desktop/scripts/build-panel-manifest.mjs`, and shipping
a Hub release. Keep the GitHub copy up until most people have that Hub.

## Privacy

The Hub asks for the manifest only when the editor is using it: when its window opens, on **Check
again**, and when they install or update a panel (in the window or from the menu-bar icon). Never on a
timer in the background, and never on behalf of the Premiere panel.
The requests carry no cookies, account or identifiers. Together with the daily update check, these
are the only network requests the Hub makes.

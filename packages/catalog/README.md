# Catalog format

The contract between the desktop engine and the Premiere Pro panel. The desktop app writes
`catalog.json` into its data folder; the panel reads it (and the generated media it points to)
directly from disk. No network connection is involved.

| Platform | Location                                                           |
| -------- | ------------------------------------------------------------------ |
| macOS    | `~/Library/Application Support/Asset Library/catalog/catalog.json` |
| Windows  | `%APPDATA%\Asset Library\catalog\catalog.json`                     |

Bump `CATALOG_VERSION` for any breaking change; the panel refuses versions it doesn't know.

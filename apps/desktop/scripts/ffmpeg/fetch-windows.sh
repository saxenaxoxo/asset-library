#!/bin/bash
# Downloads the LGPL (shared) FFmpeg 9.0 build for Windows x64 from BtbN/FFmpeg-Builds.
# Output: apps/desktop/resources/ffmpeg/win32-x64/{ffmpeg.exe,ffprobe.exe,*.dll,BUILD-INFO.txt,LICENSE.txt}
#
# Only the "lgpl" variants may be used. Never switch to the "gpl" builds.
set -euo pipefail

ASSET="ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip"
URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$ASSET"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/../../.cache/ffmpeg-win"
OUT="$ROOT/resources/ffmpeg/win32-x64"

mkdir -p "$WORK" "$OUT"
curl -fL --proto '=https' -o "$WORK/$ASSET" "$URL"
if command -v sha256sum >/dev/null; then SHA=$(sha256sum "$WORK/$ASSET" | cut -d' ' -f1); else SHA=$(shasum -a 256 "$WORK/$ASSET" | cut -d' ' -f1); fi

rm -rf "$WORK/extract" && mkdir -p "$WORK/extract"
unzip -q "$WORK/$ASSET" -d "$WORK/extract"
PKG="$(find "$WORK/extract" -mindepth 1 -maxdepth 1 -type d | head -1)"

case "$(basename "$PKG")" in
  *-lgpl-*) ;;
  *) echo "Refusing non-LGPL package: $PKG" >&2; exit 1 ;;
esac

rm -f "$OUT"/*.exe "$OUT"/*.dll
cp "$PKG"/bin/ffmpeg.exe "$PKG"/bin/ffprobe.exe "$PKG"/bin/*.dll "$OUT/"
cp "$PKG/LICENSE.txt" "$OUT/LICENSE.txt"
{
  echo "FFmpeg 9.0 (BtbN LGPL shared build) for win32-x64, fetched $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Download: $URL"
  echo "Download SHA-256: $SHA"
  echo "Upstream package: $(basename "$PKG")"
  echo "Build scripts and sources: https://github.com/BtbN/FFmpeg-Builds"
  echo "License: LGPL (BtbN lgpl builds use LGPL-3.0; see LICENSE.txt)"
} > "$OUT/BUILD-INFO.txt"
echo "Done: $OUT"

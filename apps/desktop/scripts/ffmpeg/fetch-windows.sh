#!/bin/bash
# Downloads a pinned, checksum-verified LGPL (shared) FFmpeg 9.0 build for Windows x64 from BtbN/FFmpeg-Builds.
# Output: apps/desktop/resources/ffmpeg/win32-x64/{ffmpeg.exe,ffprobe.exe,*.dll,BUILD-INFO.txt,LICENSE.txt}
#
# Only the "lgpl" variants may be used. Never switch to the "gpl" builds.
set -euo pipefail

# Pinned to a month-end build: BtbN keeps those long-term (daily builds are deleted after a few
# weeks). To update, pick a newer month-end tag and asset, and paste the SHA-256 that GitHub
# lists for it (`gh api repos/BtbN/FFmpeg-Builds/releases/tags/<tag>`).
TAG="autobuild-2026-09-30-13-08"
ASSET="ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-shared-9.0.zip"
EXPECTED_SHA="7157177b8a6cb2174c1650ba8c71b363f2c78cba5330f88c4c02cf5b2b880646"
URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/$TAG/$ASSET"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/../../.cache/ffmpeg-win"
OUT="$ROOT/resources/ffmpeg/win32-x64"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "$WORK" "$OUT"
# Reuse a previous download only if it's intact.
if [ ! -f "$WORK/$ASSET" ] || [ "$(sha256 "$WORK/$ASSET")" != "$EXPECTED_SHA" ]; then
  curl -fL --proto '=https' -o "$WORK/$ASSET" "$URL"
fi
SHA="$(sha256 "$WORK/$ASSET")"
if [ "$SHA" != "$EXPECTED_SHA" ]; then
  echo "Checksum mismatch for $ASSET: got $SHA, expected $EXPECTED_SHA" >&2
  rm -f "$WORK/$ASSET"
  exit 1
fi

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
  echo "FFmpeg 9.0.2 (BtbN LGPL shared build, $TAG) for win32-x64"
  echo "Download: $URL"
  echo "Download SHA-256 (verified): $SHA"
  echo "Upstream package: $(basename "$PKG")"
  echo "Build scripts and sources: https://github.com/BtbN/FFmpeg-Builds"
  echo "License: LGPL (BtbN lgpl builds use LGPL-3.0; see LICENSE.txt)"
} > "$OUT/BUILD-INFO.txt"
echo "Done: $OUT"

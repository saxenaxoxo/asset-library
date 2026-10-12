#!/bin/bash
# Builds LGPL-only ffmpeg + ffprobe for macOS from official source.
# Usage: scripts/ffmpeg/build-macos.sh [arm64|x86_64]   (default: host arch)
# Output: apps/desktop/resources/ffmpeg/darwin-<arch>/{ffmpeg,ffprobe,BUILD-INFO.txt}
#
# Licensing: never add --enable-gpl, --enable-nonfree, or GPL libraries (x264, x265, ...).
# The configure line and source URL are recorded in BUILD-INFO.txt, which ships with the app.
set -euo pipefail

VERSION="9.0.2"
SHA256="8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e" # ffmpeg-9.0.2.tar.xz
ARCH="${1:-$(uname -m)}"
case "$ARCH" in arm64) NODE_ARCH=arm64 ;; x86_64) NODE_ARCH=x64 ;; *) echo "Unknown arch $ARCH" >&2; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/../../.cache/ffmpeg"
OUT="$ROOT/resources/ffmpeg/darwin-$NODE_ARCH"
TARBALL="$WORK/ffmpeg-$VERSION.tar.xz"
SRC="$WORK/ffmpeg-$VERSION-$ARCH"

mkdir -p "$WORK" "$OUT"
if [ ! -f "$TARBALL" ]; then
  curl -fL --proto '=https' -o "$TARBALL" "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
fi
ACTUAL_SHA=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
if [ -n "$SHA256" ] && [ "$SHA256" != "$ACTUAL_SHA" ]; then
  echo "Checksum mismatch for $TARBALL" >&2
  exit 1
fi

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xf "$TARBALL" -C "$SRC" --strip-components 1
cd "$SRC"

CONFIGURE_FLAGS=(
  --arch="$ARCH"
  --cc="clang -arch $ARCH"
  --extra-cflags="-mmacosx-version-min=13.0"
  --extra-ldflags="-mmacosx-version-min=13.0"
  --enable-static --disable-shared
  --disable-autodetect
  --enable-videotoolbox --enable-audiotoolbox --enable-zlib
  --disable-network --disable-ffplay --disable-doc --disable-debug
  --disable-x86asm
)
if [ "$ARCH" != "$(uname -m)" ]; then CONFIGURE_FLAGS+=(--enable-cross-compile); fi

./configure "${CONFIGURE_FLAGS[@]}"
make -j"${JOBS:-4}"

cp ffmpeg ffprobe "$OUT/"
strip "$OUT/ffmpeg" "$OUT/ffprobe"

# Refuse to ship anything that isn't LGPL.
# (ffmpeg wraps its license text across lines, so join them before matching.)
LICENSE_TEXT=$("$OUT/ffmpeg" -hide_banner -L 2>&1 | tr '\n' ' ')
if ! printf '%s' "$LICENSE_TEXT" | grep -q "GNU Lesser General Public License" ||
  printf '%s' "$LICENSE_TEXT" | grep -q "GNU General Public License as published"; then
  echo "Built ffmpeg is not LGPL-only: ${LICENSE_TEXT:0:300}" >&2
  exit 1
fi

{
  echo "FFmpeg $VERSION, built $(date -u +%Y-%m-%dT%H:%M:%SZ) for darwin-$NODE_ARCH"
  echo "Source: https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  echo "Source SHA-256: $ACTUAL_SHA"
  echo "License: LGPL-2.1-or-later (no --enable-gpl, no --enable-nonfree)"
  echo "Configure flags: ${CONFIGURE_FLAGS[*]}"
} > "$OUT/BUILD-INFO.txt"
cp "$SRC/COPYING.LGPLv2.1" "$OUT/LICENSE.txt"
echo "Done: $OUT"

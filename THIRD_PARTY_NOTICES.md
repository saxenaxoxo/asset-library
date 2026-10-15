# Third-party notices

Asset Library includes the following third-party software. Each component keeps its own license.
Update this file whenever a shipped (runtime) dependency or bundled binary is added. Build-only tools
aren't listed.

| Component                                                                                               | Version | License                   | Source                                          |
| ------------------------------------------------------------------------------------------------------- | ------- | ------------------------- | ----------------------------------------------- |
| Electron (includes Chromium and Node.js; their notices ship as `LICENSES.chromium.html` inside the app) | 44.7.0  | MIT                       | https://github.com/electron/electron            |
| React, React DOM                                                                                        | 19.3.0  | MIT                       | https://github.com/facebook/react               |
| Zod                                                                                                     | 4.6.5   | MIT                       | https://github.com/colinhacks/zod               |
| @electron-toolkit/utils                                                                                 | 4.0.0   | MIT                       | https://github.com/alex8088/electron-toolkit    |
| Lucide icons (lucide-react)                                                                             | 0.548.0 | ISC                       | https://github.com/lucide-icons/lucide          |
| Geist typeface (via @fontsource-variable/geist)                                                         | 5.3.0   | SIL Open Font License 1.1 | https://github.com/vercel/geist-font            |
| better-sqlite3                                                                                          | 13.0.3  | MIT                       | https://github.com/WiseLibs/better-sqlite3      |
| SQLite (bundled in better-sqlite3)                                                                      | 3.x     | Public domain             | https://sqlite.org                              |
| FFmpeg / FFprobe, macOS                                                                                 | 9.0.2   | LGPL-2.1-or-later         | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz |
| FFmpeg / FFprobe, Windows (BtbN build)                                                                  | 9.0.2   | LGPL-3.0                  | https://github.com/BtbN/FFmpeg-Builds           |

## FFmpeg

Asset Library runs FFmpeg and FFprobe as separate programs to make thumbnails, previews and waveforms.
It doesn't link to them. Only LGPL builds are shipped: no `--enable-gpl` and no `--enable-nonfree`.

- **macOS:** built from the unmodified FFmpeg 9.0.2 source release by `apps/desktop/scripts/ffmpeg/build-macos.sh`.
  The source checksum and the exact configure flags are recorded in `BUILD-INFO.txt` next to the binaries
  (inside the app: `Contents/Resources/ffmpeg/`).
- **Windows:** the LGPL shared build from BtbN/FFmpeg-Builds, pinned and checksum-verified by
  `apps/desktop/scripts/ffmpeg/fetch-windows.sh`. Its build scripts, and the sources they use, are
  published at https://github.com/BtbN/FFmpeg-Builds. Details are in `BUILD-INFO.txt` next to the binaries
  (inside the install folder: `resources\ffmpeg\`).

The full license text ships as `LICENSE.txt` beside the binaries. You may replace the bundled FFmpeg
with your own compatible build by swapping those files. On request we will provide the corresponding
source code for the shipped FFmpeg binaries.

## Planned (not yet included)

- **Meguri** (MIT, © 2026 amgsk, https://github.com/zabuton-app/meguri): if any code is adapted from it, its full MIT notice goes here.

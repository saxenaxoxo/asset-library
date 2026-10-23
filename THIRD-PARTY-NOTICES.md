# Third-party notices

Asset Library's own code is under the [MIT License](LICENSE). It ships with the third-party components
below, and each keeps its own licence. Every shipped component was checked for compatibility with MIT
on 2026-10-23: none is GPL, AGPL or under a non-commercial licence. Update this file whenever a shipped
dependency or bundled binary changes. Build-only tools are listed at the end for completeness.

## Goated Panels Hub (desktop app)

| Component                                            | Version                       | How it ships                                | Licence                                                     | Copyright                             | Source                                          |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| Electron (with Chromium 152, Node.js and V8)         | 44.7.0                        | app framework                               | MIT; Chromium BSD-3-Clause plus its own third-party notices | Electron contributors; GitHub Inc.    | https://github.com/electron/electron            |
| React, React DOM, scheduler                          | 19.3.0 / 0.28.0               | compiled into the window's JavaScript       | MIT                                                         | Meta Platforms, Inc. and affiliates   | https://github.com/facebook/react               |
| Zod                                                  | 4.6.5                         | app package                                 | MIT                                                         | Colin McDonnell                       | https://github.com/colinhacks/zod               |
| @electron-toolkit/utils                              | 4.0.0                         | app package                                 | MIT                                                         | Alex.Wei                              | https://github.com/alex8088/electron-toolkit    |
| better-sqlite3                                       | 13.0.3                        | native add-on                               | MIT                                                         | Joshua Wise                           | https://github.com/WiseLibs/better-sqlite3      |
| node-addon-api                                       | 8.9.2                         | headers used by better-sqlite3              | MIT                                                         | Node.js API collaborators             | https://github.com/nodejs/node-addon-api        |
| SQLite (inside better-sqlite3)                       | 3.53.4                        | compiled into the add-on                    | Public domain                                               | none                                  | https://sqlite.org                              |
| Lucide icons (lucide-react)                          | 0.548.0                       | icons compiled into the window's JavaScript | ISC (parts from Feather: MIT)                               | Lucide Contributors; Cole Bemis       | https://github.com/lucide-icons/lucide          |
| Tailwind CSS (generated CSS)                         | 4.3.3                         | the window's stylesheet                     | MIT                                                         | Tailwind Labs, Inc.                   | https://github.com/tailwindlabs/tailwindcss     |
| Vite module preload helper                           | 7.3.7                         | a few lines in the window's JavaScript      | MIT                                                         | VoidZero Inc. and Vite contributors   | https://github.com/vitejs/vite                  |
| Geist typeface (@fontsource-variable/geist)          | 5.3.0                         | font files in the window                    | SIL Open Font License 1.1                                   | The Geist Project Authors             | https://github.com/vercel/geist-font            |
| FFmpeg and FFprobe, macOS                            | 9.0.2                         | separate programs                           | LGPL-2.1-or-later                                           | FFmpeg developers                     | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz |
| FFmpeg and FFprobe, Windows (BtbN LGPL shared build) | 9.0.2                         | separate programs and their DLLs            | LGPL-3.0-or-later                                           | FFmpeg developers; BtbN build scripts | https://github.com/BtbN/FFmpeg-Builds           |
| NSIS (Windows installer only)                        | from electron-builder 26.15.3 | inside the setup program                    | zlib                                                        | NSIS contributors                     | https://nsis.sourceforge.io                     |

## Premiere Pro panel (CEP and UXP builds)

The panel contains only Asset Library's own code. It uses Premiere Pro's APIs, which Premiere provides
at run time and which aren't distributed with the panel. It bundles no fonts: it uses the system's.

## Brand assets

The app icon, tray icons and the Goated Panels and Asset Library marks in `packages/branding/assets/`
are original work. The MIT License covers their copyright, but the names "Goated Panels" and
"Asset Library" and their logos aren't licensed as trademarks.

## FFmpeg

Asset Library runs FFmpeg and FFprobe as separate programs to make thumbnails, previews and waveforms.
It doesn't link to them. Only LGPL builds are shipped: no `--enable-gpl` and no `--enable-nonfree`.

- **macOS:** built from the unmodified FFmpeg 9.0.2 source release by `apps/desktop/scripts/ffmpeg/build-macos.sh`.
  The source checksum and the exact configure flags are recorded in `BUILD-INFO.txt` next to the binaries
  (inside the app: `Contents/Resources/ffmpeg/`).
- **Windows (not released yet):** the LGPL shared build from BtbN/FFmpeg-Builds, pinned and
  checksum-verified by `apps/desktop/scripts/ffmpeg/fetch-windows.sh`. It is licensed LGPL-3.0-or-later
  and its DLLs include further LGPL-compatible libraries (for example dav1d, libvpx, libwebp, opus, LAME,
  FreeType and HarfBuzz) whose build scripts and sources are published at https://github.com/BtbN/FFmpeg-Builds.

The licence text ships as `LICENSE.txt` beside the binaries. You may replace the bundled FFmpeg with your
own compatible build by swapping those files. On request we will provide the corresponding source code for
the shipped FFmpeg binaries.

## Licence texts

### MIT License

Applies to Electron, React, React DOM, scheduler, Zod, @electron-toolkit/utils, better-sqlite3,
node-addon-api, Tailwind CSS and Vite, each under its own copyright line from the table above.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Lucide (ISC, with MIT parts from Feather)

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Geist (SIL Open Font License 1.1)

```
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) Geist-Italic[wght].ttf: Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### SQLite

SQLite is in the public domain: "The author disclaims copyright to this source code. In place of a legal
notice, here is a blessing: May you do good and not evil. May you find forgiveness for yourself and
forgive others. May you share freely, never taking more than you give."

### Chromium

Chromium's licence and the notices of its own third-party components are published at
https://source.chromium.org/chromium/chromium/src/+/main:LICENSE and in Electron's
`LICENSES.chromium.html`, which comes with every Electron release.

## Build-only tools (not shipped)

electron-builder, electron-vite, Vite, @vitejs/plugin-react, @tailwindcss/vite, esbuild, Vitest,
ESLint and Prettier (MIT); TypeScript, Playwright, sharp and Adobe's `@adobe/premierepro` type
definitions (Apache-2.0). Adobe's ZXPSignCmd is used to sign the CEP build; it isn't in this repository.

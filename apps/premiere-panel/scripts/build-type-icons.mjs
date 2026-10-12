// Renders the small file-type icons the folder tree uses (PNG, because Premiere's panel runtime
// draws PNGs reliably). Run once after changing a shape: node scripts/build-type-icons.mjs
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
// sharp is a dependency of the desktop app; borrow it rather than adding it to the panel.
const require = createRequire(join(here, '..', '..', 'desktop', 'package.json'))
const sharp = require('sharp')

const ink = '#c9c7d6'
const icons = {
  folder: `<path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.6h4.2A1.5 1.5 0 0 1 14 7.1v4.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" fill="${ink}"/>`,
  audio: `<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="#5eead4" stroke-width="1.2"/><path d="M4 8h.01M5.5 6.5v3M7 5v6M8.5 6v4M10 4.5v7M11.5 7v2" stroke="#5eead4" stroke-width="1.1" stroke-linecap="round"/>`,
  video: `<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="#a78bfa" stroke-width="1.2"/><path d="M6.5 6v4l3.5-2z" fill="#a78bfa"/>`,
  image: `<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="#fbbf24" stroke-width="1.2"/><circle cx="5.5" cy="6.5" r="1.1" fill="#fbbf24"/><path d="M3 11.5l3-3 2 2 2-2.5 3 3.5" fill="none" stroke="#fbbf24" stroke-width="1.1" stroke-linejoin="round"/>`,
  template: `<rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="#f472b6" stroke-width="1.2"/><path d="M4.5 6h7M4.5 8.5h5M4.5 11h3" stroke="#f472b6" stroke-width="1.1" stroke-linecap="round"/>`
}

const out = join(here, '..', 'public', 'icons', 'types')
mkdirSync(out, { recursive: true })
for (const [name, body] of Object.entries(icons)) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`
  )
  await sharp(svg, { density: 384 })
    .resize(32, 32)
    .png()
    .toFile(join(out, `${name}.png`))
}
console.log(`Wrote ${Object.keys(icons).length} icons to ${out}`)

// Renders packages/branding/assets/app-icon.svg to build/icon.png (1024×1024).
// electron-builder derives the macOS .icns and Windows .ico from that PNG.
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, '../../packages/branding/assets/app-icon.svg')
const target = join(root, 'build/icon.png')

await mkdir(dirname(target), { recursive: true })
await sharp(source, { density: 300 }).resize(1024, 1024).png().toFile(target)
console.log(`Wrote ${target}`)

// Small image shown under the cursor while dragging files out of the app.
const dragIcon = join(root, 'resources/drag-icon.png')
await mkdir(dirname(dragIcon), { recursive: true })
await sharp(join(root, '../../packages/branding/assets/logo-mark.svg'), { density: 300 })
  .resize(64, 64)
  .png()
  .toFile(dragIcon)
console.log(`Wrote ${dragIcon}`)

// Tray icons. macOS menu bar: a black-on-transparent "template" image that macOS recolours for
// light and dark menu bars (the name must end in "Template"). Windows notification area: the
// coloured mark. Both at 16 px plus a 2x version for high-DPI screens.
const markSvg = await readFile(join(root, '../../packages/branding/assets/logo-mark.svg'), 'utf8')
const monochromeSvg = Buffer.from(markSvg.replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="#000000"'))
for (const [name, svg] of [
  ['trayTemplate', monochromeSvg],
  ['tray', Buffer.from(markSvg)]
]) {
  for (const [suffix, size] of [
    ['', 16],
    ['@2x', 32]
  ]) {
    const target = join(root, `resources/${name}${suffix}.png`)
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(target)
    console.log(`Wrote ${target}`)
  }
}

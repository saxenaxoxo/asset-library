// Zips dist/ into an installable .ccx (a ZIP with manifest.json at its root).
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'dist', 'manifest.json'), 'utf8'))
const outDir = join(root, 'release')
const out = join(outDir, `Asset-Library-Premiere-${manifest.version}.ccx`)
await mkdir(outDir, { recursive: true })
await rm(out, { force: true })
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: join(root, 'dist') })
console.log(`Wrote ${out}`)

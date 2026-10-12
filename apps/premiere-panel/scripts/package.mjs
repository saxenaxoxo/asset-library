// Zips a build for installing: dist/ into a .ccx (UXP; a ZIP with manifest.json at its root), or
// dist-cep/ into a .zip of the CEP extension folder (signing into a .zxp is a separate step).
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cep = process.argv.includes('--cep')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const outDir = join(root, 'release')
const out = join(
  outDir,
  cep ? `Asset-Library-Premiere-CEP-${version}.zip` : `Asset-Library-Premiere-${version}.ccx`
)
await mkdir(outDir, { recursive: true })
await rm(out, { force: true })
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: join(root, cep ? 'dist-cep' : 'dist') })
console.log(`Wrote ${out}`)

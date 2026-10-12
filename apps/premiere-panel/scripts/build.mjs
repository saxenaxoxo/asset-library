// Bundles the panel for one of its two hosts: Premiere's UXP runtime (default, dist/) or its
// CEP runtime (--cep, dist-cep/). Same UI code; the host layer (src/host-*/) is chosen here.
// UXP provides `premierepro`, `uxp`, `fs` and `os` at runtime; CEP provides Node's modules.
import { build, context } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')
// `--diag` builds in the hit-testing diagnostics (src/diag.ts); never for a release.
const diag = process.argv.includes('--diag')
const cep = process.argv.includes('--cep')
// `--debug` (CEP) adds the .debug file so the panel can be inspected from a browser.
const debug = process.argv.includes('--debug')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

const dist = join(root, cep ? 'dist-cep' : 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(join(root, 'public'), dist, { recursive: true })
if (cep) {
  await cp(join(root, 'cep'), dist, {
    recursive: true,
    filter: (p) => debug || !p.endsWith('.debug')
  })
  await rm(join(dist, 'manifest.json'), { force: true })
  const manifest = await readFile(join(dist, 'CSXS', 'manifest.xml'), 'utf8')
  await writeFile(join(dist, 'CSXS', 'manifest.xml'), manifest.replaceAll('__VERSION__', version))
} else {
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'))
  manifest.version = version
  await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

const options = {
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  // An IIFE keeps the bundle's top-level names off `window` (a plain script would put them
  // there, and CEP keeps its own API at window.cep).
  format: 'iife',
  platform: 'neutral',
  target: cep ? 'es2019' : 'es2020',
  external: cep ? ['fs', 'os', 'path', 'child_process'] : ['premierepro', 'uxp', 'fs', 'os'],
  alias: {
    '@catalog': join(root, '..', '..', 'packages', 'catalog'),
    '@host': join(root, 'src', cep ? 'host-cep' : 'host-uxp')
  },
  define: { PANEL_DIAG: String(diag && !cep), PANEL_VERSION: JSON.stringify(version) },
  logLevel: 'info'
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching for changes.')
} else {
  await build(options)
}

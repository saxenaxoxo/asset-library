// Bundles the panel for UXP: one CommonJS file plus the static files in public/.
// UXP provides `premierepro`, `uxp`, `fs` and `os` at runtime, so they stay external.
import { build, context } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const watch = process.argv.includes('--watch')
// `--diag` builds in the hit-testing diagnostics (src/diag.ts); never for a release.
const diag = process.argv.includes('--diag')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(join(root, 'public'), dist, { recursive: true })

const options = {
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2020',
  external: ['premierepro', 'uxp', 'fs', 'os'],
  alias: { '@catalog': join(root, '..', '..', 'packages', 'catalog') },
  define: { PANEL_DIAG: String(diag) },
  logLevel: 'info'
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching for changes. In UXP Developer Tool, use "Watch" on dist/manifest.json.')
} else {
  await build(options)
}

// Builds the Premiere Pro panel files for download and writes the manifest Goated Panels Hub
// reads (docs/releasing-panels.md). Nothing is uploaded: the script prints the commands to
// publish the files as assets of the rolling "panels" GitHub Release.
//
//   node scripts/build-panel-manifest.mjs             build + sign both panels, then write the manifest
//   node scripts/build-panel-manifest.mjs --no-build  use the files already in apps/premiere-panel/release
//
// Output (gitignored): release/panels/ at the repository root, with the .ccx (UXP), the signed
// .zxp (CEP), panels-manifest.json and SHA256SUMS-panels.txt.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(desktop, '..', '..')
const panel = join(repo, 'apps', 'premiere-panel')
const built = join(panel, 'release')
const out = join(repo, 'release', 'panels')

// Must match PANEL_MANIFEST_URL and the download allowlist in apps/desktop/src/main/security-rules.ts.
const OWNER_REPO = 'saxenaxoxo/asset-library'
const RELEASE_TAG = 'panels'
const BASE_URL = `https://github.com/${OWNER_REPO}/releases/download/${RELEASE_TAG}/`
const MANIFEST_NAME = 'panels-manifest.json'
const PRODUCT = { id: 'asset-library', name: 'Asset Library' }

const { version } = JSON.parse(await readFile(join(panel, 'package.json'), 'utf8'))
if (!process.argv.includes('--no-build')) {
  // UXP: release/Asset-Library-Premiere-<version>.ccx; CEP: release/Asset-Library-Premiere-CEP-
  // <version>.zxp (signing needs ZXPSignCmd).
  for (const script of ['package', 'sign:cep']) {
    execFileSync('pnpm', ['--filter', 'asset-library-premiere-panel', script], {
      cwd: repo,
      stdio: 'inherit',
      // pnpm is a .cmd script on Windows, which only starts through a shell.
      shell: process.platform === 'win32'
    })
  }
}

// The Premiere Pro versions each file declares it loads in, read from its own manifest.
const uxpManifest = JSON.parse(await readFile(join(panel, 'public', 'manifest.json'), 'utf8'))
const uxpHost =
  [uxpManifest.host].flat().find((host) => host.app === 'premierepro') ?? uxpManifest.host
const cepXml = await readFile(join(panel, 'cep', 'CSXS', 'manifest.xml'), 'utf8')
const cepHost = /<Host\s+Name="PPRO"\s+Version="\[([\d.]+),\s*([\d.]+)\]"/.exec(cepXml)
if (!cepHost) throw new Error('No PPRO host range in cep/CSXS/manifest.xml')
const ranges = {
  uxp: { min: String(uxpHost.minVersion), below: null },
  // CEP's "99.9" means "no upper limit".
  cep: { min: cepHost[1], below: Number(cepHost[2]) >= 99 ? null : cepHost[2] }
}

const files = [
  { build: 'cep', name: `Asset-Library-Premiere-CEP-${version}.zxp` },
  { build: 'uxp', name: `Asset-Library-Premiere-${version}.ccx` }
]
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const panels = []
const sums = []
for (const file of files) {
  const source = join(built, file.name)
  const info = await stat(source).catch(() => null)
  if (!info) {
    console.error(
      `Missing ${source}. Run without --no-build (CEP signing needs ZXPSignCmd; see apps/premiere-panel/scripts/sign-cep.mjs).`
    )
    process.exit(1)
  }
  const data = await readFile(source)
  const sha256 = createHash('sha256').update(data).digest('hex')
  await copyFile(source, join(out, file.name))
  panels.push({
    product: PRODUCT.id,
    name: PRODUCT.name,
    build: file.build,
    version,
    premiere: ranges[file.build],
    url: `${BASE_URL}${encodeURIComponent(file.name)}`,
    size: data.length,
    sha256
  })
  sums.push(`${sha256}  ${file.name}`)
}

const manifest = { schema: 1, generatedAt: new Date().toISOString(), panels }
await writeFile(join(out, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(out, 'SHA256SUMS-panels.txt'), `${sums.join('\n')}\n`)

console.log(`\nWrote ${join('release', 'panels')} for Asset Library panel ${version}:`)
for (const p of panels) console.log(`  ${p.build.toUpperCase()}  ${p.size} bytes  ${p.sha256}`)
console.log(`
To publish (run from the repository root; nothing has been uploaded):

  gh release view ${RELEASE_TAG} --repo ${OWNER_REPO} >/dev/null 2>&1 || gh release create ${RELEASE_TAG} --repo ${OWNER_REPO} --prerelease --title "Premiere Pro panels" --notes "Panel files that Goated Panels Hub downloads. Not an app release."
  gh release upload ${RELEASE_TAG} ${files.map((f) => `release/panels/${f.name}`).join(' ')} release/panels/SHA256SUMS-panels.txt --repo ${OWNER_REPO} --clobber
  gh release upload ${RELEASE_TAG} release/panels/${MANIFEST_NAME} --repo ${OWNER_REPO} --clobber

The panel files go up first, so the manifest never names a file that isn't there yet.
`)

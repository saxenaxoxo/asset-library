// Puts the Premiere Pro panel where the installer build picks it up, so every app build ships
// the panel it was built with: the UXP plugin (.ccx, Premiere 27+) always, and the signed CEP
// extension (.zxp, Premiere 24–26) when `pnpm sign:cep` has produced one. Builds and packages
// the UXP panel first, unless --no-build.
//
//   node scripts/prepare-panel.mjs            package the panel, then copy it
//   node scripts/prepare-panel.mjs --no-build copy the .ccx already in apps/premiere-panel/release
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const panel = join(desktop, '..', 'premiere-panel')
const release = join(panel, 'release')
// Gitignored; electron-builder.yml copies it into the app's resources/premiere-panel.
const out = join(desktop, '.cache', 'premiere-panel')
const windows = process.platform === 'win32'
// pnpm is a .cmd script on Windows, which only starts through a shell.
const pnpmOptions = { cwd: panel, stdio: 'inherit', shell: windows }

const { version } = JSON.parse(await readFile(join(panel, 'package.json'), 'utf8'))
const name = `Asset-Library-Premiere-${version}.ccx`
const cepName = `Asset-Library-Premiere-CEP-${version}.zxp`

if (!process.argv.includes('--no-build')) {
  try {
    execFileSync('pnpm', ['--filter', 'asset-library-premiere-panel', 'package'], pnpmOptions)
  } catch (error) {
    if (!windows) throw error
    // The panel's packaging uses `zip`, which Windows lacks; Windows' own tar writes ZIP files.
    execFileSync('pnpm', ['--filter', 'asset-library-premiere-panel', 'build'], pnpmOptions)
    const dist = join(panel, 'dist')
    await mkdir(release, { recursive: true })
    await rm(join(release, name), { force: true })
    // A .ccx is a ZIP with manifest.json at its root: list the entries so none start with "./".
    // System32's tar (bsdtar), not a GNU tar that Git may put first on the PATH.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    const entries = await readdir(dist)
    execFileSync(tar, ['-c', '-f', join(release, name), '--format', 'zip', ...entries], {
      cwd: dist,
      stdio: 'inherit'
    })
  }
}

const names = await readdir(release).catch(() => [])
if (!names.includes(name)) {
  console.error(`Missing ${join(release, name)}. Run "pnpm panel:package" first.`)
  process.exit(1)
}
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await copyFile(join(release, name), join(out, name))
if (names.includes(cepName)) {
  await copyFile(join(release, cepName), join(out, cepName))
  console.log(`Bundling the Premiere Pro panel ${version} (UXP and CEP)`)
} else {
  console.log(
    `Bundling the Premiere Pro panel ${version} (UXP only: no signed ${cepName} in release/)`
  )
}

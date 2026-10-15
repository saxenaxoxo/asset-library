// Signs the CEP build into a .zxp that Premiere accepts without developer flags, using Adobe's
// ZXPSignCmd (not bundled: put it at tools/ZXPSignCmd or point ZXPSIGNCMD at it). A self-signed
// certificate is created once at tools/goated-panels-cep.p12 (organisation: Goated Panels, decision
// I3); the older tools/asset-library-cep.p12 (Saxenas Creation) is no longer used but left in place.
// The Goated Panels Hub removes installed copies before installing, so the new signer doesn't
// block updates. The password comes from
// ZXP_CERT_PASSWORD (default: a local development password, fine for a self-signed certificate).
//
//   node scripts/sign-cep.mjs            → release/Asset-Library-Premiere-CEP-<version>.zxp
import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist-cep')
const tools = join(root, 'tools')
const signer = process.env.ZXPSIGNCMD ?? join(tools, 'ZXPSignCmd')
const certificate = join(tools, 'goated-panels-cep.p12')
const password = process.env.ZXP_CERT_PASSWORD ?? 'asset-library-dev'
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

if (
  !(await access(signer).then(
    () => true,
    () => false
  ))
) {
  console.error(
    `ZXPSignCmd not found at ${signer}. Download it from Adobe's CEP-Resources and put it there.`
  )
  process.exit(1)
}
if (
  !(await access(dist).then(
    () => true,
    () => false
  ))
) {
  console.error('No dist-cep/. Run "pnpm build:cep" first.')
  process.exit(1)
}
await mkdir(tools, { recursive: true })
if (
  !(await access(certificate).then(
    () => true,
    () => false
  ))
) {
  execFileSync(
    signer,
    ['-selfSignedCert', 'IN', 'Delhi', 'Goated Panels', 'Asset Library', password, certificate],
    { stdio: 'inherit' }
  )
}
const out = join(root, 'release', `Asset-Library-Premiere-CEP-${version}.zxp`)
await mkdir(dirname(out), { recursive: true })
await rm(out, { force: true })
// A timestamp keeps the signature valid after the certificate expires. ZXPSignCmd 4.1.2 can
// crash while timestamping on recent macOS; the ZXP is then signed without one.
try {
  execFileSync(
    signer,
    ['-sign', dist, out, certificate, password, '-tsa', 'http://timestamp.digicert.com'],
    {
      stdio: 'inherit'
    }
  )
} catch {
  console.warn('Timestamping failed; signing without a timestamp.')
  await rm(out, { force: true })
  execFileSync(signer, ['-sign', dist, out, certificate, password], { stdio: 'inherit' })
}
execFileSync(signer, ['-verify', out], { stdio: 'inherit' })
console.log(`Wrote ${out}`)

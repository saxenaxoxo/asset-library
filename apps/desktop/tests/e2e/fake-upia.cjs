// Stands in for Adobe's plug-in installer (UnifiedPluginInstallerAgent) in end-to-end tests, so
// they never touch a real Premiere Pro. The app runs it with its own Node (ELECTRON_RUN_AS_NODE).
// State lives in the JSON file named by FAKE_UPIA_STATE:
//   { premiere: ['26.5.2'], cep: ['0.4.1'], uxp: [], installs: [{ file, sha256, size }] }
// It prints what the real one prints for --list all / --install / --remove (or /list … on Windows).
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')

const stateFile = process.env.FAKE_UPIA_STATE
if (!stateFile) {
  console.log('FAKE_UPIA_STATE is not set')
  process.exit(1)
}
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2))
const [flag = '', value = ''] = process.argv.slice(2)
const action = flag.replace(/^(--|\/)/, '')

if (action === 'list') {
  const lines = []
  for (const host of state.premiere) {
    lines.push(
      `${state.cep.length + state.uxp.length} extensions installed for Premiere Pro (ver ${host})`
    )
    lines.push(' Status                        Extension Name                         Version')
    for (const v of state.uxp)
      lines.push(` Enabled    Asset Library                                               ${v}`)
    for (const v of state.cep)
      lines.push(` Enabled    Asset Library CEP                                           ${v}`)
    lines.push('')
  }
  lines.push('0 extension installed for Others')
  console.log(lines.join('\n'))
} else if (action === 'install') {
  const match = /Asset-Library-Premiere-(CEP-)?(\d+(?:\.\d+){1,3})\.(?:ccx|zxp)$/.exec(value)
  if (!match) {
    console.log('Installation failed: not a panel file')
    process.exit(1)
  }
  const data = readFileSync(value)
  state.installs.push({
    file: value,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex')
  })
  ;(match[1] ? state.cep : state.uxp).push(match[2])
  save()
  console.log('Installation Successful')
} else if (action === 'remove') {
  ;(value === 'Asset Library CEP' ? state.cep : state.uxp).shift()
  save()
  console.log('Removal Successful')
} else {
  console.log(`Unknown command ${flag}`)
  process.exit(1)
}

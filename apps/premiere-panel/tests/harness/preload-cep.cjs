// Fake CEP bridge for the harness: ExtendScript calls are answered by a stand-in `AL` object
// and recorded in window.__calls; file dialogs return what the test queued (window.__pick).
// Node itself is real (nodeIntegration), with the home folder pointed at the test library.
const os = require('os')

os.homedir = () => process.env.HARNESS_HOME

const calls = []
window.__calls = calls
let playhead = 12.5

const reply = (ok, message) => JSON.stringify({ ok, message })

const AL = {
  ping: () => reply(true, '26.5.2'),
  place: (path, name, mode, v, a, mogrt, kind) => {
    calls.push({ type: 'place', path, name, mode, v, a, mogrt, kind, seconds: playhead })
    const verb = mogrt ? 'Added' : mode === 'insert' ? 'Inserted' : 'Placed'
    return reply(true, `${verb} ${name} at the playhead.`)
  },
  placeMany: (items, mode, v, a) => {
    for (const item of items) {
      calls.push({ type: 'place', path: item.path, name: item.name, mode, v, a, seconds: playhead })
      playhead += 1
      calls.push({ type: 'playhead', seconds: playhead })
    }
    return reply(true, `Added ${items.length} assets at the playhead.`)
  },
  importOnly: (path, name) => {
    calls.push({ type: 'import', path })
    return reply(true, `Imported ${name} into the Asset Library bin.`)
  }
}

window.__adobe_cep__ = {
  // The panel always sends `AL.<name>(<JSON literals>)`; anything else is a script error.
  evalScript: (script, callback) => {
    let result = 'EvalScript error.'
    const match = /^AL\.(\w+)\(([\s\S]*)\)$/.exec(script)
    if (match && typeof AL[match[1]] === 'function') {
      try {
        result = AL[match[1]](...JSON.parse(`[${match[2]}]`))
      } catch {
        result = 'EvalScript error.'
      }
    }
    setTimeout(() => callback(result), 0)
  },
  getHostEnvironment: () =>
    JSON.stringify({ appName: 'PPRO', appVersion: process.env.HARNESS_HOST_VERSION || '26.5.2' }),
  registerKeyEventsInterest: (json) => calls.push({ type: 'keys', count: JSON.parse(json).length })
}

window.cep = {
  fs: {
    showOpenDialog: (_multiple, directory) => {
      const pick = window.__pick || {}
      if (directory) return { err: 0, data: pick.folder ? [pick.folder] : [] }
      return { err: 0, data: pick.files || [] }
    }
  },
  util: {
    openURLInDefaultBrowser: (url) => {
      calls.push({ type: 'open-url', url })
      return { err: 0 }
    }
  }
}

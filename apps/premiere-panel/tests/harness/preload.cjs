// Fake UXP + Premiere Pro modules for the harness. Every Premiere call is recorded in window.__calls.
const fs = require('fs')

const calls = []
const toPath = (p) => decodeURIComponent(String(p).replace(/^file:(\/\/)?/, ''))

function makeFolder(name) {
  return {
    __folder: true,
    name,
    items: [],
    getItems: async function () {
      return this.items
    }
  }
}
const root = makeFolder('root')
let playhead = 12.5
const sequence = {
  getPlayerPosition: async () => ({ seconds: playhead }),
  setPlayerPosition: async (time) => {
    playhead = time.seconds
    calls.push({ type: 'playhead', seconds: time.seconds })
    return true
  }
}
const editor = {
  createOverwriteItemAction: (item, time, v, a) => ({
    type: 'overwrite',
    item: item.name,
    seconds: time.seconds,
    v,
    a
  }),
  createInsertProjectItemAction: (item, time, v, a, limit) => ({
    type: 'insert',
    item: item.name,
    seconds: time.seconds,
    v,
    a,
    limit
  }),
  insertMogrtFromPath: (p, time, v, a) => {
    calls.push({ type: 'mogrt', path: p, v, a })
    return [{ type: 'mogrt-track-item' }]
  }
}
const project = {
  getRootItem: async () => root,
  getActiveSequence: async () => sequence,
  importFiles: async (paths, suppressUI, bin) => {
    calls.push({ type: 'import', paths, bin: bin.name })
    for (const p of paths) {
      const id = `clip-${bin.items.length + 1}`
      bin.items.push({
        __clip: true,
        name: p.split('/').pop(),
        getId: () => id,
        getMediaFilePath: async () => p
      })
    }
    return true
  },
  lockedAccess: (fn) => fn(),
  executeTransaction: (fn) => {
    fn({
      addAction: (action) => {
        if (action.type === 'bin') root.items.push(makeFolder(action.name))
        else calls.push(action)
        return true
      }
    })
    return true
  }
}
root.createBinAction = (name) => ({ type: 'bin', name })

window.__calls = calls
const modules = {
  premierepro: {
    Project: { getActiveProject: async () => project },
    FolderItem: { cast: (item) => (item.__folder ? item : null) },
    ClipProjectItem: { cast: (item) => (item.__clip ? item : null) },
    ProjectItem: { cast: (item) => item },
    SequenceEditor: { getEditor: () => editor },
    TickTime: { createWithSeconds: (seconds) => ({ seconds }) }
  },
  uxp: {
    host: { name: 'premierepro', version: process.env.HARNESS_HOST_VERSION || '26.5.2' },
    shell: {
      openExternal: async (url) => {
        calls.push({ type: 'open-url', url })
        return true
      }
    },
    storage: {
      formats: { utf8: 'utf8', binary: 'binary' },
      localFileSystem: {
        getDataFolder: async () => ({ nativePath: '/tmp/none' }),
        // The picker returns what the test queued (window.__pick), like a real choice.
        getFileForOpening: async (options) => {
          const files = (window.__pick && window.__pick.files) || []
          const entries = files.map((p) => ({ nativePath: p }))
          return options && options.allowMultiple ? entries : entries[0] || null
        },
        getFolder: async () => {
          const folder = window.__pick && window.__pick.folder
          return folder ? { nativePath: folder } : null
        },
        getEntryWithUrl: async (url) => ({
          nativePath: toPath(url),
          read: async () => fs.readFileSync(toPath(url), 'utf8')
        }),
        createPersistentToken: async () => 'token',
        getEntryForPersistentToken: async () => {
          throw new Error('none')
        }
      }
    }
  },
  fs: {
    readFile: async (p, options) => {
      const data = fs.readFileSync(toPath(p))
      return options && options.encoding
        ? data.toString('utf8')
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    },
    lstat: async (p) => fs.statSync(toPath(p)),
    writeFile: async (p, data) => fs.writeFileSync(toPath(p), data),
    mkdir: async (p, options) => fs.mkdirSync(toPath(p), options)
  },
  os: { homedir: () => process.env.HARNESS_HOME }
}
window.require = (id) => modules[id]

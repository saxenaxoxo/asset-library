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
const sequence = { getPlayerPosition: async () => ({ seconds: 12.5 }) }
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
    SequenceEditor: { getEditor: () => editor }
  },
  uxp: {
    host: { name: 'premierepro', version: process.env.HARNESS_HOST_VERSION || '26.5.2' },
    storage: {
      formats: { utf8: 'utf8', binary: 'binary' },
      localFileSystem: {
        getDataFolder: async () => ({ nativePath: '/tmp/none' }),
        getFileForOpening: async () => null,
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
    lstat: async (p) => fs.statSync(toPath(p))
  },
  os: { homedir: () => process.env.HARNESS_HOME }
}
window.require = (id) => modules[id]

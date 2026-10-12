// Mocked host for automated panel tests: runs the built panel in Chromium (Electron) with a fake
// Premiere Pro API. This checks the panel's UI and logic, NOT real Premiere behaviour.
const { app, BrowserWindow } = require('electron')
const path = require('path')

// A fresh profile per run, so remembered settings (folder, view) never leak between tests.
if (process.env.HARNESS_HOME)
  app.setPath('userData', path.join(process.env.HARNESS_HOME, 'profile'))

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 380,
    height: 680,
    backgroundColor: '#121216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: false,
      sandbox: false,
      webSecurity: false
    }
  })
  window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
})

import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEffectsScript, type AfterEffectsJob } from './after-effects-script'

export interface AfterEffectsInstall {
  /** macOS: application name for AppleScript. Windows: path to AfterFX.exe. */
  target: string
  version: string
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 20_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout.trim())
    })
  })
}

/** Finds the newest installed After Effects ("Adobe After Effects 2026" etc.). */
export function findAfterEffects(
  platform: NodeJS.Platform = process.platform
): AfterEffectsInstall | null {
  const base = platform === 'win32' ? 'C:\\Program Files\\Adobe' : '/Applications'
  let names: string[]
  try {
    names = readdirSync(base).filter((name) =>
      /^Adobe After Effects (\d{4}|CC \d{4}|Beta)$/.test(name)
    )
  } catch {
    return null
  }
  names.sort().reverse()
  for (const name of names) {
    if (platform === 'win32') {
      const exe = join(base, name, 'Support Files', 'AfterFX.exe')
      if (existsSync(exe)) return { target: exe, version: name.replace('Adobe After Effects ', '') }
    } else if (existsSync(join(base, name, `${name}.app`))) {
      return { target: name, version: name.replace('Adobe After Effects ', '') }
    }
  }
  return null
}

async function isRunning(install: AfterEffectsInstall): Promise<boolean> {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq AfterFX.exe', '/NH']).catch(() => '')
    return out.toLowerCase().includes('afterfx.exe')
  }
  // Arguments are passed as argv, never spliced into the AppleScript source.
  const out = await run('osascript', [
    '-e',
    'on run argv',
    '-e',
    'return application (item 1 of argv) is running',
    '-e',
    'end run',
    install.target
  ]).catch(() => 'false')
  return out === 'true'
}

/**
 * Runs the import script in the After Effects that's already open. Never launches After Effects:
 * if it isn't running, the user is asked to open it first.
 */
export async function sendToAfterEffects(job: AfterEffectsJob): Promise<string> {
  const install = findAfterEffects()
  if (!install) throw new Error("After Effects isn't installed on this computer.")
  if (!(await isRunning(install))) {
    throw new Error(`Open After Effects ${install.version} with a project, then send again.`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'asset-library-ae-'))
  const script = join(dir, 'send.jsx')
  await writeFile(script, afterEffectsScript(job), 'utf8')
  try {
    if (process.platform === 'win32') {
      await run(install.target, ['-r', script])
    } else {
      await run('osascript', [
        '-e',
        'on run argv',
        '-e',
        'tell application (item 1 of argv) to DoScriptFile (item 2 of argv)',
        '-e',
        'end run',
        install.target,
        script
      ])
    }
  } finally {
    // Give After Effects a moment to read the script before it's removed.
    setTimeout(() => void rm(dir, { recursive: true, force: true }), 30_000)
  }
  return job.addToComp
    ? 'Sent to After Effects and added to the active comp.'
    : 'Imported into After Effects.'
}

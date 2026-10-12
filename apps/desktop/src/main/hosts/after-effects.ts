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
    // Generous: After Effects runs the script synchronously, and importing a big .aep takes time.
    execFile(file, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout.trim())
    })
  })
}

const AE_FOLDER = /^Adobe After Effects (\d{4}|CC \d{4}|\(Beta\)|Beta)$/

/** Newest first: release years descending ("CC 2019" counts as 2019), betas after releases. */
export function sortAfterEffectsFolders(names: readonly string[]): string[] {
  const year = (name: string): number => Number(/(\d{4})$/.exec(name)?.[1] ?? 0)
  return names.filter((name) => AE_FOLDER.test(name)).sort((a, b) => year(b) - year(a))
}

/** Every installed After Effects, newest first ("Adobe After Effects 2026" etc.). */
export function findAfterEffectsInstalls(
  platform: NodeJS.Platform = process.platform
): AfterEffectsInstall[] {
  const base = platform === 'win32' ? 'C:\\Program Files\\Adobe' : '/Applications'
  let names: string[]
  try {
    names = sortAfterEffectsFolders(readdirSync(base))
  } catch {
    return []
  }
  const installs: AfterEffectsInstall[] = []
  for (const name of names) {
    const version = name.replace('Adobe After Effects ', '')
    if (platform === 'win32') {
      const exe = join(base, name, 'Support Files', 'AfterFX.exe')
      if (existsSync(exe)) installs.push({ target: exe, version })
    } else if (existsSync(join(base, name, `${name}.app`))) {
      installs.push({ target: name, version })
    }
  }
  return installs
}

/** The newest installed After Effects, or null. */
export function findAfterEffects(
  platform: NodeJS.Platform = process.platform
): AfterEffectsInstall | null {
  return findAfterEffectsInstalls(platform)[0] ?? null
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
  const installs = findAfterEffectsInstalls()
  const newest = installs[0]
  if (!newest) throw new Error("After Effects isn't installed on this computer.")
  // With several versions installed, send to whichever one is open.
  let install: AfterEffectsInstall | undefined
  for (const candidate of installs) {
    if (await isRunning(candidate)) {
      install = candidate
      break
    }
  }
  if (!install) {
    throw new Error(`Open After Effects ${newest.version} with a project, then send again.`)
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

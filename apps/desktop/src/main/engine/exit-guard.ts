// Makes sure quitting ends the process, even when the app itself can't finish exiting.
//
// Seen on macOS: after the app's asynchronous file work stopped answering (see io-watchdog.ts),
// quitting got stuck inside Electron's own teardown, which waits for that file work to finish. The
// app sat "not responding" for a day until it was force quit. JavaScript can't run at that point,
// so the guard is a tiny separate process: it waits for the app to exit, ends it if it hasn't
// within the grace period, and, when asked, starts the app again afterwards.

export interface ExitGuardOptions {
  platform: NodeJS.Platform
  pid: number
  graceMs: number
  /** Start this program once the app has gone (used for the watchdog's quiet restart). */
  relaunch?: { file: string; args: string[] }
}

export const EXIT_GRACE_MS = 20_000

const POSIX_SCRIPT = [
  'pid=$1; n=$2; shift 2',
  'while [ "$n" -gt 0 ] && kill -0 "$pid" 2>/dev/null; do sleep 1; n=$((n-1)); done',
  'kill -9 "$pid" 2>/dev/null',
  'n=10; while [ "$n" -gt 0 ] && kill -0 "$pid" 2>/dev/null; do sleep 1; n=$((n-1)); done',
  '[ "$#" -gt 0 ] && exec "$@"',
  'exit 0'
].join('\n')

/** One argument quoted for a Windows command line (the rules CommandLineToArgvW reads back). */
export function windowsArg(value: string): string {
  if (value !== '' && !/[\s"]/.test(value)) return value
  let out = '"'
  let slashes = 0
  for (const ch of value) {
    if (ch === '\\') {
      slashes++
      continue
    }
    if (ch === '"') out += '\\'.repeat(slashes * 2 + 1) + '"'
    else out += '\\'.repeat(slashes) + ch
    slashes = 0
  }
  return out + '\\'.repeat(slashes * 2) + '"'
}

/**
 * The helper to start. App values never become script source: on macOS and Linux they're
 * arguments to the script, on Windows environment variables the script reads.
 */
export function exitGuardCommand(options: ExitGuardOptions): {
  file: string
  args: string[]
  env: Record<string, string>
} {
  const seconds = Math.max(1, Math.ceil(options.graceMs / 1000))
  const pid = Math.trunc(options.pid)
  if (options.platform === 'win32') {
    const lines = [
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      `if ($p) { if (-not $p.WaitForExit(${seconds * 1000})) { Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; $p.WaitForExit(10000) | Out-Null } }`
    ]
    const env: Record<string, string> = {}
    if (options.relaunch) {
      env['EXIT_GUARD_FILE'] = options.relaunch.file
      if (options.relaunch.args.length) {
        env['EXIT_GUARD_ARGS'] = options.relaunch.args.map(windowsArg).join(' ')
        lines.push(
          'Start-Process -FilePath $env:EXIT_GUARD_FILE -ArgumentList $env:EXIT_GUARD_ARGS'
        )
      } else {
        lines.push('Start-Process -FilePath $env:EXIT_GUARD_FILE')
      }
    }
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        lines.join('; ')
      ],
      env
    }
  }
  const relaunch = options.relaunch ? [options.relaunch.file, ...options.relaunch.args] : []
  return {
    file: '/bin/sh',
    args: ['-c', POSIX_SCRIPT, 'exit-guard', String(pid), String(seconds), ...relaunch],
    env: {}
  }
}

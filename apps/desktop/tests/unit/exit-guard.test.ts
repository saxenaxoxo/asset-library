import { execFile, spawn } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exitGuardCommand, windowsArg } from '../../src/main/engine/exit-guard'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const run = (file: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(file, args, (error) => (error ? reject(error) : resolve()))
  })

describe('exitGuardCommand', () => {
  it('on Windows, waits, force-stops and restarts, with app values kept out of the script', () => {
    const exe = "C:\\Program Files\\Goated Panels Hub\\Hub’s'; Remove-Item x.exe"
    const { file, args, env } = exitGuardCommand({
      platform: 'win32',
      pid: 4321,
      graceMs: 20_000,
      relaunch: { file: exe, args: ['--background'] }
    })
    expect(file).toBe('powershell.exe')
    const script = args[args.length - 1]
    expect(script).toContain('Get-Process -Id 4321')
    expect(script).toContain('WaitForExit(20000)')
    expect(script).toContain('Stop-Process -Id 4321 -Force')
    expect(script).toContain(
      'Start-Process -FilePath $env:EXIT_GUARD_FILE -ArgumentList $env:EXIT_GUARD_ARGS'
    )
    expect(script).not.toContain('Remove-Item')
    expect(script).not.toContain('Program Files')
    expect(env).toEqual({ EXIT_GUARD_FILE: exe, EXIT_GUARD_ARGS: '--background' })
  })

  it('quotes Windows arguments the way the command line reads them back', () => {
    expect(windowsArg('--background')).toBe('--background')
    expect(windowsArg('')).toBe('""')
    expect(windowsArg('a b')).toBe('"a b"')
    expect(windowsArg('say "hi"')).toBe('"say \\"hi\\""')
    expect(windowsArg('C:\\dir with space\\')).toBe('"C:\\dir with space\\\\"')
  })

  it('without a restart, starts nothing afterwards', () => {
    const { args } = exitGuardCommand({ platform: 'win32', pid: 1, graceMs: 5_000 })
    expect(args[args.length - 1]).not.toContain('Start-Process')
  })
})

describe.skipIf(process.platform === 'win32')('the exit guard on macOS and Linux', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('ends a process that hasn’t exited in time, then restarts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'asset-library-exit-guard-'))
    const stuck = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    })
    const pid = stuck.pid as number
    const marker = join(dir, 'restarted')
    const { file, args } = exitGuardCommand({
      platform: process.platform,
      pid,
      graceMs: 1_000,
      relaunch: { file: '/usr/bin/touch', args: [marker] }
    })
    await run(file, args)
    expect(alive(pid)).toBe(false)
    expect(existsSync(marker)).toBe(true)
  }, 20_000)

  it('leaves quickly, and kills nothing, when the process exits by itself', async () => {
    dir = mkdtempSync(join(tmpdir(), 'asset-library-exit-guard-'))
    const quick = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], { stdio: 'ignore' })
    const exited = new Promise((resolve) => quick.on('exit', resolve))
    const { file, args } = exitGuardCommand({
      platform: process.platform,
      pid: quick.pid as number,
      graceMs: 10_000
    })
    const started = Date.now()
    await run(file, args)
    const code = await exited
    expect(code).toBe(0)
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 20_000)
})

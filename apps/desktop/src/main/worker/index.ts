// Utility process entry: runs scanning and FFmpeg work off the main process.
import { execFile } from 'child_process'
import { mkdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { RootUnavailableError, scanRoot } from './scanner'
import { PROBE_ARGS } from '../media/probe'
import { ffmpegVersion } from '../media/version'
import type { WorkerMessage, WorkerRequest } from './protocol'

const FFPROBE_TIMEOUT_MS = 20_000
const FFMPEG_TIMEOUT_MS = 90_000
const MAX_PROBE_OUTPUT = 4 * 1024 * 1024

/** Scans asked to stop early (their root was removed). */
const cancelled = new Set<number>()

function send(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

/** Runs a binary with an argument array (never a shell) and returns its stdout. */
function run(binary: string, args: string[], timeout: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: MAX_PROBE_OUTPUT, cwd }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'ffprobe-version': {
      const stdout = await run(request.ffprobePath, ['-version'], 10_000)
      return ffmpegVersion(stdout.split('\n')[0] ?? '')
    }
    case 'scan': {
      try {
        return await scanRoot({
          rootPath: request.rootPath,
          exclusions: request.exclusions,
          known: request.known,
          onBatch: (entries) => send({ kind: 'scan-batch', requestId: request.id, entries }),
          shouldStop: () => cancelled.has(request.id)
        })
      } finally {
        cancelled.delete(request.id)
      }
    }
    case 'cancel':
      cancelled.add(request.target)
      return true
    case 'probe':
      return run(request.ffprobePath, [...PROBE_ARGS, request.path], FFPROBE_TIMEOUT_MS)
    case 'media': {
      // Outputs are bare file names, so ffmpeg (run from outDir) can only write inside the cache.
      await mkdir(request.outDir, { recursive: true })
      const results: Record<string, string | null> = {}
      for (const job of request.jobs) {
        const target = join(request.outDir, job.file)
        try {
          await run(request.ffmpegPath, job.args, FFMPEG_TIMEOUT_MS, request.outDir)
          const info = await stat(target)
          results[job.output] = info.size > 0 ? job.file : null
        } catch {
          await rm(target, { force: true })
          results[job.output] = null
        }
      }
      return results
    }
  }
}

process.parentPort.on('message', (event: { data: WorkerRequest }) => {
  const request = event.data
  handle(request).then(
    (value) => send({ kind: 'result', id: request.id, ok: true, value }),
    (error: Error) =>
      send({
        kind: 'result',
        id: request.id,
        ok: false,
        error: error.message,
        code: error instanceof RootUnavailableError ? 'root-unavailable' : 'failed'
      })
  )
})

// Utility process entry: runs scanning and FFmpeg work off the main process.
import { execFile } from 'child_process'
import { RootUnavailableError, scanRoot } from './scanner'
import { PROBE_ARGS } from '../media/probe'
import type { WorkerMessage, WorkerRequest } from './protocol'

const FFPROBE_TIMEOUT_MS = 20_000
const MAX_PROBE_OUTPUT = 4 * 1024 * 1024

function send(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

/** Runs a binary with an argument array (never a shell) and returns its stdout. */
function run(binary: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: MAX_PROBE_OUTPUT }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'ffprobe-version': {
      const stdout = await run(request.ffprobePath, ['-version'], 10_000)
      const firstLine = stdout.split('\n')[0] ?? ''
      return firstLine.replace(/^ffprobe version\s+/, '').split(' ')[0] ?? firstLine
    }
    case 'scan': {
      const filesSeen = await scanRoot({
        rootPath: request.rootPath,
        exclusions: request.exclusions,
        known: request.known,
        onBatch: (entries) => send({ kind: 'scan-batch', requestId: request.id, entries })
      })
      return { filesSeen }
    }
    case 'probe':
      return run(request.ffprobePath, [...PROBE_ARGS, request.path], FFPROBE_TIMEOUT_MS)
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

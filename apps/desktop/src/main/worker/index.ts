// Utility process entry: runs scanning and FFmpeg work off the main process.
import { execFile } from 'child_process'
import type { WorkerRequest, WorkerResponse } from './protocol'

const FFPROBE_TIMEOUT_MS = 10_000

function reply(message: WorkerResponse): void {
  process.parentPort.postMessage(message)
}

function ffprobeVersion(ffprobePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Argument array, no shell: paths and arguments are never interpreted by a shell.
    execFile(ffprobePath, ['-version'], { timeout: FFPROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error) return reject(error)
      const firstLine = stdout.split('\n')[0] ?? ''
      resolve(firstLine.replace(/^ffprobe version\s+/, '').split(' ')[0] ?? firstLine)
    })
  })
}

process.parentPort.on('message', (event: { data: WorkerRequest }) => {
  const request = event.data
  switch (request.type) {
    case 'ffprobe-version':
      ffprobeVersion(request.ffprobePath).then(
        (value) => reply({ id: request.id, ok: true, value }),
        (error: Error) => reply({ id: request.id, ok: false, error: error.message })
      )
      break
  }
})

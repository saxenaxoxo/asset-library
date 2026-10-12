import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { WorkerRequest, WorkerResponse } from './protocol'

type Pending = { resolve: (value: string) => void; reject: (error: Error) => void }
type RequestWithoutId = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, 'id'>
    : never
  : never

/** Starts the utility process and sends it requests, matching replies by ID. */
export class WorkerClient {
  private readonly child: UtilityProcess
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    this.child = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
      serviceName: 'Asset Library Worker'
    })
    this.child.on('message', (message: WorkerResponse) => {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new Error(message.error))
    })
    this.child.on('exit', () => {
      for (const entry of this.pending.values()) entry.reject(new Error('Worker process exited'))
      this.pending.clear()
    })
  }

  request(request: RequestWithoutId): Promise<string> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.postMessage({ ...request, id })
    })
  }

  stop(): void {
    this.child.kill()
  }
}

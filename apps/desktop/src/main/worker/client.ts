import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { ScanEntry } from '../library/types'
import type { WorkerErrorCode, WorkerMessage, WorkerRequest, WorkerResults } from './protocol'

type RequestOf<T extends WorkerRequest['type']> = Omit<Extract<WorkerRequest, { type: T }>, 'id'>

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onBatch?: (entries: ScanEntry[]) => void
}

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly code: WorkerErrorCode
  ) {
    super(message)
  }
}

/**
 * Talks to the utility process. Replies are matched by request ID; scan batches stream to the
 * caller's callback. If the worker crashes, pending requests fail and the next request restarts it.
 */
export class WorkerClient {
  private child: UtilityProcess | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private stopped = false

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
      serviceName: 'Asset Library Worker'
    })
    child.on('message', (message: WorkerMessage) => this.onMessage(message))
    child.on('exit', () => {
      this.child = null
      for (const entry of this.pending.values()) {
        entry.reject(new WorkerError('The background worker stopped unexpectedly', 'crashed'))
      }
      this.pending.clear()
    })
    this.child = child
    return child
  }

  private onMessage(message: WorkerMessage): void {
    if (message.kind === 'scan-batch') {
      const entry = this.pending.get(message.requestId)
      try {
        entry?.onBatch?.(message.entries)
      } catch (error) {
        // A failed batch must not become an uncaught exception in main; fail the scan instead.
        this.pending.delete(message.requestId)
        entry?.reject(error as Error)
        this.child?.postMessage({ type: 'cancel', target: message.requestId, id: this.nextId++ })
      }
      return
    }
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new WorkerError(message.error, message.code))
  }

  /**
   * Sends a request. Aborting `signal` asks the worker to stop a running scan; the scan then
   * resolves early with whatever it found.
   */
  request<T extends WorkerRequest['type']>(
    request: RequestOf<T> & { type: T },
    onBatch?: (entries: ScanEntry[]) => void,
    signal?: AbortSignal
  ): Promise<WorkerResults[T]> {
    if (this.stopped) return Promise.reject(new WorkerError('Worker is shut down', 'failed'))
    const id = this.nextId++
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onBatch })
      child.postMessage({ ...request, id })
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.has(id) && this.child === child)
            child.postMessage({ type: 'cancel', target: id, id: this.nextId++ })
        },
        { once: true }
      )
    })
  }

  stop(): void {
    this.stopped = true
    this.child?.kill()
  }
}

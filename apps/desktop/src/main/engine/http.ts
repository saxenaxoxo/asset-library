// The small HTTP surface panel downloads need, so the download logic can be tested against a
// local server without Electron. The Electron implementation is in ./electron-http.

export interface HttpResponse {
  status: number
  /** The Content-Length header, or null when the server didn't send one. */
  contentLength: number | null
  body: AsyncIterable<Uint8Array>
}

export interface HttpGetOptions {
  signal: AbortSignal
  /** Asked before each redirect is followed; a refused redirect fails the request. */
  isAllowedRedirect(url: string): boolean
}

/** GET a URL. Rejects on network errors, refused redirects and aborts; never follows others. */
export type HttpGet = (url: string, options: HttpGetOptions) => Promise<HttpResponse>

export type DownloadErrorCode = 'offline' | 'server' | 'verification' | 'cancelled'

/** A download that didn't complete, with the reason in a form the window can show. */
export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

/** Most redirects one request follows (GitHub uses one). */
export const MAX_REDIRECTS = 5

/**
 * A push-driven async iterable: event-style streams (Electron's IncomingMessage) feed it, the
 * downloader reads it with `for await`. Buffers until read.
 */
export function pushIterable<T>(): {
  iterable: AsyncIterable<T>
  push(value: T): void
  end(): void
  fail(error: Error): void
} {
  const queue: T[] = []
  let done = false
  let failure: Error | null = null
  let wake: (() => void) | null = null
  const notify = (): void => {
    wake?.()
    wake = null
  }
  const iterable: AsyncIterable<T> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift() as T
          continue
        }
        if (failure) throw failure
        if (done) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    }
  }
  return {
    iterable,
    push: (value) => {
      queue.push(value)
      notify()
    },
    end: () => {
      done = true
      notify()
    },
    fail: (error) => {
      failure ??= error
      notify()
    }
  }
}

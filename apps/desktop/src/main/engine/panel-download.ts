import { createHash } from 'crypto'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir, readdir, rename, rm } from 'fs/promises'
import nodePath from 'path'
import { DownloadError, type HttpGet } from './http'

// Downloads one file into the app's data folder and keeps it only if its size and SHA-256 match
// what the manifest promised. The file is written as "<name>.part" while it downloads and renamed
// only once verified; on any failure or cancel the partial file is deleted. Hashing happens chunk
// by chunk as the bytes arrive (panel files are a few MB), so it never blocks for long.

/** No bytes for this long ends the download as a network failure. */
export const STALL_TIMEOUT_MS = 30_000

export interface DownloadProgress {
  received: number
  total: number
}

export interface VerifiedDownload {
  url: string
  /** The exact size and lowercase hex SHA-256 the file must have. */
  size: number
  sha256: string
  /** The final path; the file is written beside it as `<dest>.part`. */
  dest: string
  http: HttpGet
  signal: AbortSignal
  isAllowedRedirect(url: string): boolean
  onProgress?(progress: DownloadProgress): void
  stallTimeoutMs?: number
}

/** Reads each chunk, failing on abort or when no bytes arrive for `stallMs`. */
async function* guarded(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  stallMs: number
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]()
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined
      let onAbort: (() => void) | undefined
      const stopped = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DownloadError('offline', 'The download stopped: no data arrived.')),
          stallMs
        )
        onAbort = () => reject(new DownloadError('cancelled', 'Download cancelled.'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        const next = await Promise.race([iterator.next(), stopped])
        if (next.done) return
        yield next.value
      } finally {
        clearTimeout(timer)
        if (onAbort) signal.removeEventListener('abort', onAbort)
      }
    }
  } finally {
    void iterator.return?.()
  }
}

function write(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

/**
 * Opens the partial file. A folder that can't be written to (permissions, a full disk) rejects
 * here; without an 'error' listener the stream's error would crash the main process.
 */
function openPart(path: string): Promise<WriteStream> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path, { flags: 'wx' })
    stream.once('error', reject)
    stream.once('open', () => {
      stream.off('error', reject)
      // Later errors reach write()'s callback; this keeps them from being "unhandled".
      stream.on('error', () => undefined)
      resolve(stream)
    })
  })
}

function close(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed || stream.destroyed) resolve()
    else {
      stream.once('error', () => resolve())
      stream.end(() => resolve())
    }
  })
}

/** Waits for the server's answer, but not forever: no answer within `ms` is a network failure. */
async function answered<T>(request: Promise<T>, ms: number, abort: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort()
      reject(new DownloadError('offline', "The download server didn't answer."))
    }, ms)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The failure as a DownloadError: cancels, network errors and server answers kept apart. */
function asDownloadError(error: unknown, signal: AbortSignal): DownloadError {
  if (error instanceof DownloadError) return error
  if (signal.aborted) return new DownloadError('cancelled', 'Download cancelled.')
  const message = error instanceof Error ? error.message : String(error)
  return new DownloadError('offline', `Couldn't download the panel: ${message}`)
}

/**
 * Downloads `url` to `dest`, verifying size and SHA-256. Resolves to `dest` only when the file
 * matches; otherwise rejects with a DownloadError and leaves nothing behind.
 */
export async function downloadVerified(options: VerifiedDownload): Promise<string> {
  const { dest, signal, size } = options
  const part = `${dest}.part`
  await mkdir(nodePath.dirname(dest), { recursive: true })
  await rm(part, { force: true })
  const stallMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  // Our own handle on the request: a cancel ends it, and so does any failure below, so a
  // refused or stalled download doesn't keep a connection open in the background.
  const request = new AbortController()
  const onCancel = (): void => request.abort()
  signal.addEventListener('abort', onCancel, { once: true })
  let stream: WriteStream | null = null
  try {
    if (signal.aborted) throw new DownloadError('cancelled', 'Download cancelled.')
    const response = await answered(
      options.http(options.url, {
        signal: request.signal,
        isAllowedRedirect: options.isAllowedRedirect
      }),
      stallMs,
      onCancel
    )
    if (response.status < 200 || response.status > 299) {
      throw new DownloadError(
        'server',
        `The download server answered ${response.status}, so the panel wasn't downloaded.`
      )
    }
    if (response.contentLength !== null && response.contentLength !== size) {
      throw new DownloadError(
        'verification',
        `The download is ${response.contentLength} bytes, not the ${size} the download list promised, so it wasn't used.`
      )
    }
    const hash = createHash('sha256')
    stream = await openPart(part)
    let received = 0
    options.onProgress?.({ received, total: size })
    for await (const chunk of guarded(response.body, signal, stallMs)) {
      received += chunk.byteLength
      if (received > size) {
        throw new DownloadError(
          'verification',
          'The download is larger than the download list promised, so it was deleted.'
        )
      }
      hash.update(chunk)
      await write(stream, chunk)
      options.onProgress?.({ received, total: size })
    }
    await close(stream)
    if (received !== size) {
      throw new DownloadError(
        'verification',
        `The download ended early (${received} of ${size} bytes), so it was deleted.`
      )
    }
    if (hash.digest('hex') !== options.sha256) {
      throw new DownloadError(
        'verification',
        "The download didn't match its checksum, so it was deleted and nothing was installed."
      )
    }
    await rename(part, dest)
    return dest
  } catch (error) {
    request.abort()
    if (stream) await close(stream)
    await rm(part, { force: true }).catch(() => undefined)
    throw asDownloadError(error, signal)
  } finally {
    signal.removeEventListener('abort', onCancel)
  }
}

/** Reads a small text body (the manifest), refusing anything over `maxBytes`. */
export async function readText(
  http: HttpGet,
  url: string,
  options: { signal: AbortSignal; isAllowedRedirect(url: string): boolean; maxBytes: number }
): Promise<string> {
  const response = await http(url, options)
  if (response.status < 200 || response.status > 299) {
    throw new DownloadError('server', `The download server answered ${response.status}.`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of guarded(response.body, options.signal, STALL_TIMEOUT_MS)) {
    total += chunk.byteLength
    if (total > options.maxBytes) {
      throw new DownloadError('server', 'The download list is larger than expected.')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Deletes everything left in the downloads folder (partial files from a crash or quit). */
export async function clearDownloads(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    names.map((name) => rm(nodePath.join(dir, name), { recursive: true, force: true }))
  )
}

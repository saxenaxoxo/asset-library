import { net } from 'electron'
import { MAX_REDIRECTS, pushIterable, type HttpGet } from './http'

/**
 * GET through Electron's network stack (the system's proxy settings apply). No cookies or
 * credentials are sent, nothing is cached, and every redirect is checked before it's followed.
 */
export const electronHttpGet: HttpGet = (url, { signal, isAllowedRedirect }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'))
      return
    }
    const request = net.request({
      url,
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      useSessionCookies: false
    })
    let redirects = 0
    let settled = false
    const body = pushIterable<Uint8Array>()
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
      body.fail(error)
    }
    const onAbort = (): void => {
      request.abort()
      fail(new Error('Cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })

    request.on('redirect', (_status, _method, redirectUrl) => {
      redirects += 1
      if (redirects > MAX_REDIRECTS || !isAllowedRedirect(redirectUrl)) {
        request.abort()
        fail(new Error(`Refused a redirect to ${new URL(redirectUrl).host}`))
        return
      }
      request.followRedirect()
    })
    request.on('response', (response) => {
      const length = response.headers['content-length']
      const value = Array.isArray(length) ? length[0] : length
      const parsed = value === undefined ? Number.NaN : Number(value)
      response.on('data', (chunk: Buffer) => body.push(new Uint8Array(chunk)))
      response.on('end', () => {
        signal.removeEventListener('abort', onAbort)
        body.end()
      })
      response.on('aborted', () => fail(new Error('The connection was closed')))
      response.on('error', (error: Error) => fail(error))
      settled = true
      resolve({
        status: response.statusCode,
        contentLength: Number.isFinite(parsed) ? parsed : null,
        body: body.iterable
      })
    })
    request.on('error', (error) => fail(error))
    request.end()
  })

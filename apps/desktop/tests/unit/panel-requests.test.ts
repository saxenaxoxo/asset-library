import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelRequest, RequestResult } from '@catalog/requests'
import { PanelRequests } from '../../src/main/library/panel-requests'

let catalogDir: string
let handled: [string, PanelRequest][]
let reported: RequestResult[]
let clock: number
let requests: PanelRequests

const result = (id: string, ok: boolean): RequestResult => ({ id, ok, message: id, at: 0 })

beforeEach(() => {
  catalogDir = mkdtempSync(join(tmpdir(), 'asset-library-panel-requests-'))
  mkdirSync(join(catalogDir, 'requests'))
  handled = []
  reported = []
  requests = new PanelRequests(
    catalogDir,
    {
      handle: vi.fn(async (id: string, request: PanelRequest) => {
        handled.push([id, request])
        return result(id, true)
      }),
      unreadable: (id) => result(id, false),
      report: (r) => reported.push(r)
    },
    1000,
    () => clock
  )
})

afterEach(() => {
  requests.stop()
  rmSync(catalogDir, { recursive: true, force: true })
})

/** Drops a request file and moves the clock past its settle time. */
function drop(name: string, body: unknown): void {
  const file = join(catalogDir, 'requests', name)
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
  clock = statSync(file).mtimeMs + 1000
}

describe('PanelRequests', () => {
  it('handles each request once, in name order, and reports a result by file name', async () => {
    drop('2-b.json', { type: 'rescan' })
    drop('1-a.json', { type: 'clear-cache' })
    expect(await requests.poll()).toBe(2)
    expect(handled).toEqual([
      ['1-a', { type: 'clear-cache' }],
      ['2-b', { type: 'rescan' }]
    ])
    expect(reported.map((r) => r.id)).toEqual(['1-a', '2-b'])
    expect(readdirSync(join(catalogDir, 'requests'))).toEqual([])
    expect(await requests.poll()).toBe(0)
  })

  it('deletes malformed and oversized files and reports them as failed', async () => {
    drop('bad.json', '{ not json')
    drop('unknown.json', { type: 'format-disk' })
    drop('huge.json', JSON.stringify({ type: 'rescan', pad: 'x'.repeat(70 * 1024) }))
    expect(await requests.poll()).toBe(3)
    expect(handled).toEqual([])
    expect(reported).toEqual([
      result('bad', false),
      result('huge', false),
      result('unknown', false)
    ])
    expect(readdirSync(join(catalogDir, 'requests'))).toEqual([])
  })

  it('leaves a file that may still be being written for the next round', async () => {
    drop('fresh.json', { type: 'rescan' })
    clock = statSync(join(catalogDir, 'requests', 'fresh.json')).mtimeMs + 100
    expect(await requests.poll()).toBe(0)
    expect(readdirSync(join(catalogDir, 'requests'))).toEqual(['fresh.json'])
    clock += 1000
    expect(await requests.poll()).toBe(1)
    expect(handled).toEqual([['fresh', { type: 'rescan' }]])
  })

  it('ignores files that are not requests', async () => {
    drop('note.txt', 'hello')
    drop('half.json.tmp', { type: 'rescan' })
    expect(await requests.poll()).toBe(0)
    expect(readdirSync(join(catalogDir, 'requests')).sort()).toEqual(['half.json.tmp', 'note.txt'])
  })

  it('does nothing after stop()', async () => {
    drop('late.json', { type: 'rescan' })
    requests.stop()
    expect(await requests.poll()).toBe(0)
    expect(readdirSync(join(catalogDir, 'requests'))).toEqual(['late.json'])
  })
})

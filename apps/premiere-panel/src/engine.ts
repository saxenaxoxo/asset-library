// Talking to the background engine: requests go out as files, status comes back in engine.json.
// The contract lives in packages/catalog/requests.ts.
import {
  ENGINE_START_URL,
  ENGINE_STALE_MS,
  ENGINE_STATUS_FILE,
  parseEngineStatus,
  REQUESTS_FOLDER,
  requestId,
  type EngineStatus,
  type PanelRequest
} from '@catalog/requests'
import { ensureFolder, joinPath, modifiedTime, readText, splitPath, writeText } from './files'

const uxp = require('uxp')

/** Sends a request to the engine. Returns its id, to match the result in engine.json later. */
export async function sendRequest(catalogPath: string, request: PanelRequest): Promise<string> {
  const dir = joinPath(splitPath(catalogPath).dir, REQUESTS_FOLDER)
  await ensureFolder(dir)
  const id = requestId(Date.now(), Math.random())
  await writeText(joinPath(dir, `${id}.json`), JSON.stringify(request))
  return id
}

let lastStatusMtime: number | null = null
let lastStatus: EngineStatus | null = null

/** The engine's latest status, or null if it has never run. Cheap to call often. */
export async function readEngineStatus(catalogPath: string): Promise<EngineStatus | null> {
  const path = joinPath(splitPath(catalogPath).dir, ENGINE_STATUS_FILE)
  const mtime = await modifiedTime(path)
  if (mtime !== null && mtime === lastStatusMtime) return lastStatus
  try {
    lastStatus = parseEngineStatus(await readText(path))
    lastStatusMtime = mtime
  } catch {
    lastStatus = null
  }
  return lastStatus
}

export function engineRunning(status: EngineStatus | null, now = Date.now()): boolean {
  return status !== null && now - status.updatedAt < ENGINE_STALE_MS
}

/** Asks the OS to start the engine (it registers the assetlibrary:// scheme). */
export async function startEngine(): Promise<boolean> {
  try {
    if (!uxp.shell) return false
    await uxp.shell.openExternal(ENGINE_START_URL, 'Start the Asset Library engine')
    return true
  } catch {
    return false
  }
}

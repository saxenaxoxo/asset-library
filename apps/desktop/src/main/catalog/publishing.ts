import { WorkerError, type WorkerClient } from '../worker/client'
import type { CatalogPublishResult } from './writer'

/** Writes the panel's catalog; `full` forces a new catalog.json instead of a delta. */
export type PublishCatalog = (full: boolean) => Promise<CatalogPublishResult>

/**
 * Publishes the catalog from the utility process, so a large library never blocks the main
 * process. If the utility process can't do it at all (it couldn't open the database), falls back
 * to `local` for the rest of the session, starting with a full catalog so the two never mix.
 * A crash is just retried next time: the restarted worker writes a full catalog first.
 */
export function workerCatalogPublishing(options: {
  worker: Pick<WorkerClient, 'request'>
  request: { dbFile: string; catalogDir: string; mediaDir: string; appVersion: string }
  local: PublishCatalog
}): PublishCatalog {
  let useLocal = false
  return async (full) => {
    if (!useLocal) {
      try {
        return await options.worker.request({ type: 'catalog', ...options.request, full })
      } catch (error) {
        if (error instanceof WorkerError && error.code === 'crashed') throw error
        console.warn(`Writing the catalog in the main process instead: ${(error as Error).message}`)
        useLocal = true
        return options.local(true)
      }
    }
    return options.local(full)
  }
}

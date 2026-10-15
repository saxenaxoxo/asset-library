import { IpcChannel } from '@shared/channels'
import { handle, type SenderCheck } from './handle'
import type { WorkerClient } from '../worker/client'
import type { MediaBinaries } from '../media/binaries'
import { databaseCapabilities, type LibraryDatabase } from '../library/database'

export interface IpcDependencies {
  db: LibraryDatabase
  worker: WorkerClient
  binaries: MediaBinaries
}

/** Engine diagnostics. The installer channels live in ./installer. */
export function registerIpcHandlers(
  isTrustedSender: SenderCheck,
  { db, worker, binaries }: IpcDependencies
): void {
  handle(IpcChannel.getDiagnostics, isTrustedSender, async () => {
    const ffprobeVersion = await worker
      .request({ type: 'ffprobe-version', ffprobePath: binaries.ffprobe })
      .catch(() => null)
    return { ...databaseCapabilities(db), ffprobeVersion }
  })
}

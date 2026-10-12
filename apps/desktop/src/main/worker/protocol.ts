/** Messages between the main process and the media/scan utility process. */
export type WorkerRequest = { id: number; type: 'ffprobe-version'; ffprobePath: string }

export type WorkerResponse =
  { id: number; ok: true; value: string } | { id: number; ok: false; error: string }

// What placing an asset needs, whichever host runtime does it.

/** A problem the editor can fix (shown as-is in the panel). */
export class UserError extends Error {}

export interface InsertOptions {
  /** 0-based: 0 = V1. An index past the last track makes Premiere add a track. */
  videoTrack: number
  audioTrack: number
  mode: 'overwrite' | 'insert'
}

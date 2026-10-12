// How the engine's hidden sound player page and the main process talk, without any IPC: main
// loads the page with the asset ID in the URL, and the page reports back through its title.

/** The player page's file name (built next to the app's index.html). */
export const AUDIO_PAGE = 'audio.html'

const ASSET_ID = /^[0-9a-f-]{36}$/

/** The page URL that plays one asset (or, without an ID, plays nothing: that's "stop"). */
export function audioPageUrl(pageUrl: string, id?: string): string {
  if (id === undefined) return pageUrl
  if (!ASSET_ID.test(id)) throw new Error('Not an asset ID')
  return `${pageUrl}?id=${id}`
}

/** The asset ID a player page URL asks for, or null. Only well-formed IDs are accepted. */
export function audioIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('id')
  return id !== null && ASSET_ID.test(id) ? id : null
}

export type PlayerState = { state: 'idle' | 'playing' | 'ended' } | { state: 'error'; code: number }

/** The page's title for a state, e.g. "playing" or "error:4" (MediaError codes). */
export function playerTitle(state: PlayerState): string {
  return state.state === 'error' ? `error:${state.code}` : state.state
}

/** Reads a title written by playerTitle; null for anything else (e.g. the initial title). */
export function parsePlayerTitle(title: string): PlayerState | null {
  if (title === 'idle' || title === 'playing' || title === 'ended') return { state: title }
  const match = /^error:(\d)$/.exec(title)
  return match ? { state: 'error', code: Number(match[1]) } : null
}

/** Why a sound didn't play, in words an editor understands (from a MediaError code). */
export function playbackProblem(code: number): string {
  switch (code) {
    case 2:
      return "the file couldn't be read"
    case 3:
      return 'the file seems to be damaged'
    case 4:
      return "this sound format can't be previewed"
    default:
      return 'playback stopped'
  }
}

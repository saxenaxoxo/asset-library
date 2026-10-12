// The engine's hidden sound player (audio.html): plays the asset named in the URL once and
// reports how it went through the page title. It has no preload and no access to Node.
import { audioIdFromSearch, playerTitle, type PlayerState } from '@shared/audio-preview'

const report = (state: PlayerState): void => {
  document.title = playerTitle(state)
}

const id = audioIdFromSearch(location.search)
if (id) {
  const audio = new Audio(`asset://original/${id}`)
  audio.addEventListener('playing', () => report({ state: 'playing' }))
  audio.addEventListener('ended', () => report({ state: 'ended' }))
  audio.addEventListener('error', () => report({ state: 'error', code: audio.error?.code ?? 0 }))
  audio.play().catch(() => {
    // The error event above says why; a rejected play() without one means it was blocked.
    if (!audio.error) report({ state: 'error', code: 0 })
  })
}

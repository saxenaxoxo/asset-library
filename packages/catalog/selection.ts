// Selection and history rules shared by the panel: pure and unit-tested.

/**
 * The IDs between the anchor and the target in `order` (both ends included), as a shift-click
 * selects them. With no anchor in the list, just the target.
 */
export function rangeBetween(
  order: readonly string[],
  anchor: string | null,
  target: string
): string[] {
  const to = order.indexOf(target)
  if (to === -1) return []
  const from = anchor === null ? -1 : order.indexOf(anchor)
  if (from === -1) return [target]
  const [start, end] = from <= to ? [from, to] : [to, from]
  return order.slice(start, end + 1)
}

/** The most recently used IDs first, without repeats, at most `max` of them. */
export function recordRecent(recent: readonly string[], id: string, max = 50): string[] {
  const rest = recent.filter((known) => known !== id)
  return [id, ...rest].slice(0, max)
}

/** Pseudo-folder showing what was placed on the timeline most recently. */
export const RECENT_KEY = '*recent'

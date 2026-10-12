/**
 * Remembers favorites that were toggled but not saved and read back yet, so pressing F twice
 * quickly toggles twice instead of setting the same value again from a stale record.
 */
export class FavoriteToggle {
  private readonly pending = new Map<string, boolean>()

  /** The value to save for this press, given the favorite the record in hand shows. */
  next(id: string, shown: boolean): boolean {
    const value = !(this.pending.get(id) ?? shown)
    this.pending.set(id, value)
    return value
  }

  /** The current value, counting presses still being saved. */
  current(id: string, shown: boolean): boolean {
    return this.pending.get(id) ?? shown
  }

  /** Call when a save finished; a later press for the same asset keeps its own value. */
  saved(id: string, value: boolean): void {
    if (this.pending.get(id) === value) this.pending.delete(id)
  }
}

import { randomUUID } from 'crypto'

/**
 * Maps opaque IDs to file paths the main process has vetted, so the renderer can ask to drag
 * "item X" without ever naming a path. In M3 asset IDs from the database replace this.
 */
export class DragRegistry {
  private readonly paths = new Map<string, string>()

  register(path: string): string {
    const id = randomUUID()
    this.paths.set(id, path)
    return id
  }

  /** Paths for the given IDs; unknown IDs are dropped. */
  resolve(ids: readonly string[]): string[] {
    return ids.flatMap((id) => {
      const path = this.paths.get(id)
      return path ? [path] : []
    })
  }
}

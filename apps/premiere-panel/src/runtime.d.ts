// Minimal typings for the UXP runtime modules this panel uses (provided by Premiere at runtime).
declare function require(id: 'premierepro'): import('@adobe/premierepro').premierepro
declare function require(id: 'uxp'): UxpModule
declare function require(id: 'fs'): UxpFs
declare function require(id: 'os'): { homedir?: () => string; platform?: () => string }

interface UxpEntry {
  nativePath: string
  name?: string
  isFile?: boolean
  read(options?: { format?: unknown }): Promise<string | ArrayBuffer>
  write(data: string, options?: { format?: unknown }): Promise<unknown>
  createFile(name: string, options?: { overwrite?: boolean }): Promise<UxpEntry>
  delete(): Promise<unknown>
}

interface UxpModule {
  host: { name: string; version: string }
  shell?: { openExternal(url: string, reason?: string): Promise<unknown> }
  storage: {
    formats: { utf8: unknown; binary: unknown }
    localFileSystem: {
      getDataFolder(): Promise<UxpEntry>
      getFileForOpening(options?: {
        types?: string[]
        allowMultiple?: boolean
      }): Promise<UxpEntry | UxpEntry[] | null>
      getFolder(): Promise<UxpEntry | null>
      getEntryWithUrl(url: string): Promise<UxpEntry>
      createPersistentToken(entry: UxpEntry): Promise<string>
      getEntryForPersistentToken(token: string): Promise<UxpEntry>
    }
  }
}

interface UxpFs {
  readFile(path: string, options?: { encoding?: string }): Promise<string | ArrayBuffer>
  lstat(path: string): Promise<{ mtimeMs?: number; mtime?: Date; size?: number }>
  writeFile(path: string, data: string, options?: { encoding?: string }): Promise<unknown>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>
  unlink(path: string): Promise<unknown>
}

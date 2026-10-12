// Minimal typings for what the CEP runtime (Chromium + Node) provides to the panel.
declare function require(id: 'fs'): CepNodeFs
declare function require(id: 'os'): { homedir(): string; platform(): string }
declare function require(id: 'child_process'): {
  execFile(file: string, args: string[], callback: (error: Error | null) => void): unknown
}

interface CepNodeFs {
  promises: {
    readFile(path: string, encoding: 'utf8'): Promise<string>
    writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
    stat(path: string): Promise<{ mtimeMs: number }>
    access(path: string): Promise<void>
    mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>
    unlink(path: string): Promise<void>
  }
}

/** The bridge Premiere injects into CEP panels (what Adobe's CSInterface.js wraps). */
interface AdobeCepBridge {
  evalScript(script: string, callback: (result: string) => void): void
  getHostEnvironment(): string
  registerKeyEventsInterest(json: string): void
}

interface CepFsResult {
  err: number
  data?: string[]
}

interface CepGlobals {
  __adobe_cep__?: AdobeCepBridge
  cep?: {
    fs: {
      showOpenDialog(
        allowMultiple: boolean,
        chooseDirectory: boolean,
        title: string,
        initialPath: string,
        fileTypes: string[]
      ): CepFsResult
    }
    util: { openURLInDefaultBrowser(url: string): { err: number } }
  }
}

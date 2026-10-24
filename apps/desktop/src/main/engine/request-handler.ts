import { constants } from 'fs'
import { copyFile, mkdir, realpath, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { numberedName, plainPath, type PanelRequest, type RequestResult } from '@catalog/requests'
import { kindForFile } from '@shared/media-types'
import type { RootRecord } from '@shared/library'
import { safeJoin, type LibraryRepository } from '../library/repository'
import type { LibraryService } from '../library/service'

/** The parts of the library a panel request can reach. */
export type RequestLibrary = Pick<
  LibraryService,
  'addRoot' | 'removeRoot' | 'rescan' | 'rescanAll' | 'organizingChanged' | 'clearMedia'
>
export type RequestRepository = Pick<
  LibraryRepository,
  'getRoot' | 'listRoots' | 'getAsset' | 'setFavorite' | 'addTag' | 'removeTag'
>

/** What the handler needs from the app around it; Electron-specific, so injected. */
export interface RequestEnvironment {
  productName: string
  /** Where imports without a destination go, e.g. ~/Movies/Asset Library Imports. */
  importsFolder: string
  /** Turns the login item on or off and remembers the choice. */
  setStartAtLogin(enabled: boolean): void
  /** Turns the daily update check on or off. Absent: this build has no update check. */
  setCheckForUpdates?(enabled: boolean): void
  /** Plays sounds through the computer. Absent: sound preview isn't available. */
  audio?: {
    play(id: string): Promise<{ ok: true } | { ok: false; problem: string }>
    stop(): void
  }
  /** Asks the editor to confirm, then uninstalls the app. Absent: not offered (development). */
  uninstall?(): void
}

const NO_AUDIO = "Previewing sound from the panel isn't available in this version."
const MISSING_ASSET = "Couldn't find that asset. It may have been removed from the library."

/** Gives up looking for a free " 2", " 3"… name after this many. */
const MAX_NUMBERED_NAMES = 9999

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "1.2 GB", "340 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  if (unit === 0) return plural(bytes, 'byte')
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** Why a folder couldn't be used, in words an editor understands. */
function folderProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return "it isn't there any more"
  if (code === 'EACCES' || code === 'EPERM') return "this app isn't allowed to open it"
  return (error as Error).message.replace(/\.$/, '')
}

/** True when `child` is `parent` or inside it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

/** Copies `source` into `dir` without ever overwriting: "clip.mov", then "clip 2.mov"… */
async function copyWithoutOverwrite(source: string, dir: string): Promise<string> {
  const name = basename(source)
  for (let n = 1; n <= MAX_NUMBERED_NAMES; n++) {
    const target = join(dir, n === 1 ? name : numberedName(name, n))
    try {
      // EXCL refuses an existing file; FICLONE makes an instant copy where the disk supports it.
      await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('too many files with that name already')
}

/**
 * Carries out one request from the Premiere panel and describes the outcome in plain language.
 * Never throws: every failure becomes `ok: false` with a message the panel can show as is.
 */
export class RequestHandler {
  constructor(
    private readonly library: RequestLibrary,
    private readonly repo: RequestRepository,
    private readonly env: RequestEnvironment,
    private readonly now: () => number = Date.now
  ) {}

  async handle(id: string, request: PanelRequest): Promise<RequestResult> {
    const done = (ok: boolean, message: string): RequestResult => ({
      id,
      ok,
      message,
      at: this.now()
    })
    try {
      const [ok, message] = await this.run(request)
      return done(ok, message)
    } catch (error) {
      return done(false, `Something went wrong: ${(error as Error).message}`)
    }
  }

  /** A result for a request file that couldn't be read at all. */
  unreadable(id: string): RequestResult {
    return {
      id,
      ok: false,
      message: "That request couldn't be read, so nothing changed.",
      at: this.now()
    }
  }

  private async run(request: PanelRequest): Promise<[boolean, string]> {
    switch (request.type) {
      case 'add-folder':
        return this.addFolder(request.path)
      case 'remove-folder': {
        const root = this.repo.getRoot(request.rootId)
        if (!root) return [false, "That folder isn't in the library any more."]
        this.library.removeRoot(root.id)
        return [true, `Removed ${root.label} from the library. Your files weren't touched.`]
      }
      case 'rescan': {
        if (request.rootId === undefined) {
          const count = this.repo.listRoots().length
          if (count === 0) return [true, 'There are no library folders to check yet.']
          this.library.rescanAll()
          return [true, `Checking ${plural(count, 'library folder')} for changes`]
        }
        const root = this.repo.getRoot(request.rootId)
        if (!root) return [false, "That folder isn't in the library any more."]
        // Scans can take minutes; the result only says it started. Progress is in engine.json.
        void this.library.rescan(root.id)
        return [true, `Checking ${root.label} for changes`]
      }
      case 'set-favorite': {
        const asset = this.repo.getAsset(request.id)
        if (!asset) return [false, MISSING_ASSET]
        this.repo.setFavorite(asset.id, request.favorite)
        this.library.organizingChanged()
        return [
          true,
          request.favorite
            ? `Added ${asset.filename} to favorites`
            : `Removed ${asset.filename} from favorites`
        ]
      }
      case 'add-tag': {
        const asset = this.repo.getAsset(request.id)
        if (!asset) return [false, MISSING_ASSET]
        this.repo.addTag(asset.id, request.tag)
        this.library.organizingChanged()
        return [true, `Tagged ${asset.filename} “${request.tag}”`]
      }
      case 'remove-tag': {
        const asset = this.repo.getAsset(request.id)
        if (!asset) return [false, MISSING_ASSET]
        this.repo.removeTag(asset.id, request.tag)
        this.library.organizingChanged()
        return [true, `Removed the tag “${request.tag}” from ${asset.filename}`]
      }
      case 'import-files':
        return this.importFiles(request.files.map(plainPath), request.rootId, request.folder ?? '')
      case 'set-settings': {
        const name = this.env.productName
        const messages: string[] = []
        if (request.startAtLogin !== undefined) {
          this.env.setStartAtLogin(request.startAtLogin)
          messages.push(
            request.startAtLogin
              ? `${name} will start when you log in.`
              : `${name} won't start when you log in any more.`
          )
        }
        if (request.checkForUpdates !== undefined && this.env.setCheckForUpdates) {
          this.env.setCheckForUpdates(request.checkForUpdates)
          messages.push(
            request.checkForUpdates
              ? `${name} will check for updates once a day.`
              : `${name} won't check for updates.`
          )
        }
        return [true, messages.length > 0 ? messages.join(' ') : 'Settings saved.']
      }
      case 'clear-cache': {
        const { bytes } = await this.library.clearMedia()
        return [
          true,
          bytes > 0
            ? `Cleared ${formatBytes(bytes)} of thumbnails and previews. They'll be made again in the background.`
            : "The thumbnail cache was already empty. They'll be made again in the background."
        ]
      }
      case 'play-audio':
        return this.playAudio(request.id)
      case 'stop-audio':
        if (!this.env.audio) return [false, NO_AUDIO]
        this.env.audio.stop()
        return [true, 'Stopped the sound']
      case 'uninstall':
        if (!this.env.uninstall) return [false, "This copy of the app can't uninstall itself."]
        this.env.uninstall()
        return [true, `Confirm on your screen to uninstall ${this.env.productName}.`]
    }
  }

  private async playAudio(id: string): Promise<[boolean, string]> {
    if (!this.env.audio) return [false, NO_AUDIO]
    const asset = this.repo.getAsset(id)
    if (!asset) return [false, MISSING_ASSET]
    if (asset.kind !== 'audio') return [false, `${asset.filename} isn't a sound file.`]
    if (asset.status === 'offline') {
      return [false, `${asset.filename} isn't available. Connect its drive and try again.`]
    }
    if (asset.status === 'missing') {
      return [false, `${asset.filename} isn't in its folder any more, so it can't be played.`]
    }
    const outcome = await this.env.audio.play(asset.id)
    return outcome.ok
      ? [true, `Playing ${asset.filename}`]
      : [false, `Couldn't play ${asset.filename}: ${outcome.problem}.`]
  }

  private async addFolder(picked: string): Promise<[boolean, string]> {
    // Older panels pass on the picker's file:// URL as it is.
    const plain = plainPath(picked)
    if (!isAbsolute(plain)) {
      return [false, `Couldn't add that folder: "${picked}" isn't a full folder location.`]
    }
    // "/Volumes/X/" and "/Volumes/X", or "C:/Clips" and "C:\Clips", are the same folder.
    const path = resolve(plain)
    const existing = this.repo.listRoots().find((root) => resolve(root.path) === path)
    if (existing) return [true, `${existing.label} is already in the library`]
    try {
      const root = await this.library.addRoot(path)
      return [true, `Added ${root.label}`]
    } catch (error) {
      return [false, `Couldn't add that folder: ${folderProblem(error)}.`]
    }
  }

  /** The folder an import goes into, plus the library folder (root) it belongs to. */
  private async importDestination(
    rootId: number | undefined,
    folder: string
  ): Promise<{ dir: string; label: string; root: RootRecord | null } | string> {
    if (rootId === undefined) {
      const dir = this.env.importsFolder
      await mkdir(dir, { recursive: true })
      const root = this.repo.listRoots().find((r) => r.path === dir) ?? null
      return { dir, label: basename(dir), root }
    }
    const root = this.repo.getRoot(rootId)
    if (!root) return "that library folder isn't in the library any more"
    const dir = folder === '' ? root.path : safeJoin(root.path, folder)
    if (!dir) return "that folder isn't inside the library folder"
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) return "that folder isn't there any more"
      // A shortcut (symlink) inside the library must not lead somewhere outside it.
      const [realRoot, realDir] = await Promise.all([realpath(root.path), realpath(dir)])
      if (!isInside(realRoot, realDir)) return "that folder isn't inside the library folder"
    } catch (error) {
      if (root.status === 'offline') {
        return `${root.label} isn't available. Connect the drive and try again`
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return "that folder isn't there any more"
      return folderProblem(error)
    }
    return { dir, label: folder === '' ? root.label : basename(dir), root }
  }

  private async importFiles(
    files: string[],
    rootId: number | undefined,
    folder: string
  ): Promise<[boolean, string]> {
    const destination = await this.importDestination(rootId, folder).catch((error: unknown) =>
      folderProblem(error)
    )
    if (typeof destination === 'string') return [false, `Couldn't import: ${destination}.`]

    let imported = 0
    let unsupported = 0
    let notFound = 0
    const failures: string[] = []
    for (const source of files) {
      if (!isAbsolute(source) || !kindForFile(basename(source))) {
        if (!isAbsolute(source)) notFound++
        else unsupported++
        continue
      }
      try {
        const info = await stat(source)
        if (!info.isFile()) {
          notFound++
          continue
        }
        await copyWithoutOverwrite(source, destination.dir)
        imported++
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound++
        else failures.push(`${basename(source)} (${folderProblem(error)})`)
      }
    }

    if (imported > 0) {
      if (destination.root) void this.library.rescan(destination.root.id, true)
      else await this.library.addRoot(destination.dir)
    }

    const parts: string[] = []
    if (imported > 0) parts.push(`Imported ${plural(imported, 'file')} into ${destination.label}.`)
    else parts.push('Nothing was imported.')
    if (unsupported > 0) {
      parts.push(
        unsupported === 1
          ? "Skipped 1 file that isn't video, audio, an image or a template."
          : `Skipped ${plural(unsupported, 'file')} that aren't video, audio, images or templates.`
      )
    }
    if (notFound > 0) {
      parts.push(
        notFound === 1
          ? "Skipped 1 file that couldn't be found."
          : `Skipped ${plural(notFound, 'file')} that couldn't be found.`
      )
    }
    if (failures.length > 0) {
      parts.push(
        `Couldn't copy ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}.`
      )
    }
    return [imported > 0, parts.join(' ')]
  }
}

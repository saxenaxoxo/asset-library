import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'

let tempCounter = 0

/** On Windows a rename onto a file the panel is reading can briefly fail; retry a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

/**
 * Writes `<dir>/<name>` atomically: a uniquely named temp file, then a rename over the target, so
 * a reader (the Premiere panel) never sees half a file. Returns the target path.
 */
export async function writeFileAtomic(dir: string, name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, name)
  const base = name.replace(/\.[^.]*$/, '')
  const temp = join(dir, `${base}.${process.pid}.${++tempCounter}.tmp`)
  try {
    await writeFile(temp, text)
    await renameWithRetry(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return target
}

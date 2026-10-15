import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createLibrary, FFMPEG, type TestLibrary } from './harness/library'

const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string
}

// MOCKED: the CEP build of the panel with a fake CEP bridge (see tests/harness/preload-cep.cjs).
// The shared UI is covered by the UXP harness; this checks what the CEP host layer does
// differently: ExtendScript calls, the drag channel, Node file access, the dialogs.
test.skip(!existsSync(FFMPEG), 'Needs the bundled FFmpeg to make thumbnails')

let library: TestLibrary

test.beforeAll(() => {
  library = createLibrary()
})

test.afterAll(() => rmSync(library.home, { recursive: true, force: true }))

test('CEP panel places through ExtendScript and drags files the way Premiere expects', async () => {
  library.engineStatus()
  const app = await electron.launch({
    args: [join(__dirname, 'harness', 'main.cjs')],
    env: { ...process.env, HARNESS_HOME: library.home, HARNESS_TARGET: 'cep' }
  })
  const page = await app.firstWindow()
  const calls = (): Promise<Record<string, unknown>[]> =>
    page.evaluate(() => (window as unknown as { __calls: Record<string, unknown>[] }).__calls)
  const tiles = page.locator('.tile')

  // The library loads through Node, and the panel claimed its keys from Premiere.
  await expect(tiles).toHaveCount(3)
  expect((await calls()).some((c) => c.type === 'keys')).toBe(true)
  await expect(page.locator('.tree-row.section', { hasText: 'SSD' })).toBeVisible()

  // Placing goes through host.jsx with the chosen tracks and edit type.
  await page.selectOption('select[aria-label="Video track"]', '1')
  await page.selectOption('select[aria-label="Audio track"]', '1')
  await page.locator('.tile', { hasText: 'Light Leak.mov' }).click()
  await page.locator('.controls .button.primary').click()
  await expect(page.locator('.status.ok')).toContainText('Light Leak.mov')
  expect((await calls()).filter((c) => c.type === 'place')).toEqual([
    {
      type: 'place',
      path: '/Volumes/SSD/Overlays/Light Leak.mov',
      name: 'Light Leak.mov',
      mode: 'overwrite',
      v: 1,
      a: 1,
      mogrt: false,
      kind: 'video',
      seconds: 12.5
    }
  ])

  // Several at once: one ExtendScript call, placed in grid order.
  await page.locator('.tile', { hasText: 'Glitch 04.mov' }).click()
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.tile.selected')).toHaveCount(3)
  await page.locator('.controls .button.primary').click()
  await expect(page.locator('.status.ok')).toContainText('Added 3 assets')
  const placed = (await calls()).filter((c) => c.type === 'place')
  expect(placed.map((c) => c.name)).toEqual([
    'Light Leak.mov',
    'Glitch 04.mov',
    'Light Leak.mov',
    'Whoosh Big.wav'
  ])

  // Dragging a tile hands Premiere the file path on the CEP channel; a drag of a tile in a
  // multi-selection carries every selected file.
  const dragTypes = (name: string): Promise<Record<string, string>> =>
    page.locator('.tile', { hasText: name }).evaluate((node) => {
      const transfer = new DataTransfer()
      node.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true }))
      const data: Record<string, string> = {}
      for (const type of transfer.types) data[type] = transfer.getData(type)
      return data
    })
  expect(await dragTypes('Glitch 04.mov')).toEqual({
    'com.adobe.cep.dnd.file.0': '/Volumes/SSD/Transitions/Glitch 04.mov',
    'com.adobe.cep.dnd.file.1': '/Volumes/SSD/Overlays/Light Leak.mov',
    'com.adobe.cep.dnd.file.2': '/Volumes/SSD/SFX/Whoosh Big.wav'
  })
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).click()
  expect(await dragTypes('Whoosh Big.wav')).toEqual({
    'com.adobe.cep.dnd.file.0': '/Volumes/SSD/SFX/Whoosh Big.wav'
  })

  // Sound: the panel tries to play it itself; a file Chromium can't open falls back to the engine.
  await page.locator('.tile', { hasText: 'Whoosh Big.wav' }).locator('.play').click()
  await expect.poll(() => library.requests().at(-1)).toEqual({ type: 'play-audio', id: 'c' })

  // Dialogs: a folder to add, files to import.
  await page.evaluate(() => {
    ;(window as unknown as { __pick: unknown }).__pick = { folder: '/Volumes/SSD/New Pack' }
  })
  await page.locator('.tree-head .button').click()
  await expect
    .poll(() => library.requests().at(-1))
    .toEqual({ type: 'add-folder', path: '/Volumes/SSD/New Pack' })
  await page.locator('.tree-row.folder', { hasText: 'SFX' }).click()
  await page.evaluate(() => {
    ;(window as unknown as { __pick: unknown }).__pick = { files: ['/Users/me/Downloads/Boom.wav'] }
  })
  await page.locator('.toolbar .button', { hasText: 'Import' }).click()
  await expect
    .poll(() => library.requests().at(-1))
    .toEqual({
      type: 'import-files',
      files: ['/Users/me/Downloads/Boom.wav'],
      rootId: 1,
      folder: 'SFX'
    })

  // Starting the engine goes through the OS (the assetlibrary:// scheme).
  await page.locator('.tab', { hasText: 'Settings' }).click()
  await expect(page.locator('.settings')).toContainText(`Asset Library panel ${version}`)
  await page.screenshot({ path: 'test-results/panel-cep.png' })
  await app.close()
})

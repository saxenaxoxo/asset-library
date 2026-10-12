// Hit-testing diagnostics for Premiere's panel runtime. Only built in with `pnpm build --diag`.
// Writes `panel-diag.log` next to the catalog, so findings can be read outside the host.
//
// What it probes: which element kinds get mouse events inside the folder tree pane (none did in
// Premiere 26) compared with the toolbar, three alternative pane structures, and what
// `elementFromPoint` reports across the panel.
import { joinPath, splitPath, writeText } from '@host/files'

interface DiagContext {
  catalogPath(): string | null
  body: HTMLElement
  treePane: HTMLElement
  treeHead: HTMLElement
  treeSpacer: HTMLElement
  /** A production tree row for a made-up folder with this label. */
  buildRow(label: string, index: number): HTMLElement
  /** Rebuilds the toolbar's folder menu and the grid, as a catalog change does. */
  rebuildMainPane(): void
  splitter: HTMLElement
  mainPane: HTMLElement
  toolbar: HTMLElement
  grid: HTMLElement
  status(text: string): void
}

const lines: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined
let context: DiagContext | null = null

/** A note from the panel's own code paths (no-op outside a diagnostics build). */
export function note(line: string): void {
  if (context) log(line)
}

function log(line: string): void {
  lines.push(`${new Date().toISOString().slice(11, 23)} ${line}`)
  context?.status(line)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flush(), 300)
}

async function flush(): Promise<void> {
  const path = context?.catalogPath()
  if (!path) return
  try {
    await writeText(joinPath(splitPath(path).dir, 'panel-diag.log'), lines.join('\n') + '\n')
  } catch {
    // Nothing to do: the status line still shows the last event.
  }
}

function describe(node: Element | null): string {
  if (!node) return 'null'
  const cls = (node as HTMLElement).className
  return `${node.tagName.toLowerCase()}${typeof cls === 'string' && cls ? `.${cls.split(' ').join('.')}` : ''}`
}

function metrics(name: string, node: HTMLElement): string {
  let rect = 'n/a'
  try {
    const r = node.getBoundingClientRect()
    rect = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
  } catch {
    // keep n/a
  }
  return `${name}: offset ${node.offsetWidth}x${node.offsetHeight} client ${node.clientWidth}x${node.clientHeight} rect ${rect} display=${getComputedStyle(node).display}`
}

/** One of each element kind, each reporting the events it receives. */
function probes(where: string): HTMLElement[] {
  const made: HTMLElement[] = []
  const wire = (node: HTMLElement, kind: string): HTMLElement => {
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      node.addEventListener(type, () => log(`hit ${where}/${kind} ${type}`))
    }
    node.style.margin = '0 2px'
    made.push(node)
    return node
  }
  const div = document.createElement('div')
  div.textContent = 'D'
  div.style.width = '18px'
  div.style.height = '18px'
  div.style.background = '#884'
  wire(div, 'div')

  const img = document.createElement('img')
  img.src = 'checker.png'
  img.style.width = '18px'
  img.style.height = '18px'
  wire(img, 'img')

  const native = document.createElement('button')
  native.textContent = 'B'
  wire(native, 'button')

  const spectrum = document.createElement('sp-action-button')
  spectrum.textContent = 'S'
  wire(spectrum, 'sp-action-button')

  const select = document.createElement('select')
  for (const label of ['sel', 'two']) {
    const option = document.createElement('option')
    option.textContent = label
    select.append(option)
  }
  select.addEventListener('change', () => log(`hit ${where}/select change`))
  wire(select, 'select')
  return made
}

/** Alternative pane structures, each a narrow strip beside the tree, carrying a div and img probe. */
function alternativePane(name: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const pane = document.createElement('div')
  pane.className = `diag-${name}`
  Object.assign(pane.style, { width: '44px', flexShrink: '0', background: '#223' }, style)
  for (const probe of probes(name).slice(0, 2)) {
    probe.style.display = 'block'
    probe.style.margin = '4px'
    pane.append(probe)
  }
  pane.addEventListener('mousedown', () => log(`hit ${name}/pane mousedown`))
  return pane
}

/**
 * Row variants, each one step away from a production tree row, placed above the real rows.
 * Which of them get mouse events says what about the real rows blocks them.
 */
function rowVariants(ctx: DiagContext): void {
  const ROW = 26
  const strip = document.createElement('div')
  strip.className = 'diag-rows'
  strip.style.position = 'relative'
  strip.style.height = `${ROW * 10}px`
  strip.style.width = '200px'
  ctx.treePane.append(strip)
  let index = 0
  const add = (name: string, node: HTMLElement, into: HTMLElement = strip): void => {
    for (const type of ['pointerdown', 'mousedown', 'click'])
      node.addEventListener(type, () => log(`hit row/${name} ${type}`))
    if (into === strip) node.style.top = `${index++ * ROW}px`
    into.append(node)
  }
  // V1: exactly a production row.
  add('v1-prod', ctx.buildRow('V1 prod', 0))
  // V2: production row with its size and place inline instead of from the stylesheet.
  const v2 = ctx.buildRow('V2 inline', 0)
  v2.style.height = `${ROW}px`
  v2.style.left = '0px'
  v2.style.position = 'absolute'
  for (const span of Array.from(v2.children) as HTMLElement[]) {
    span.style.position = 'absolute'
    span.style.top = '0px'
    span.style.height = `${ROW}px`
  }
  add('v2-inline', v2)
  // V3: a row with plain text, no positioned spans.
  const v3 = document.createElement('div')
  v3.className = 'tree-row folder'
  v3.textContent = 'V3 text only'
  v3.style.width = '200px'
  add('v3-text', v3)
  // V4: production row without a title (tooltip).
  const v4 = ctx.buildRow('V4 no title', 0)
  v4.removeAttribute('title')
  add('v4-notitle', v4)
  // V5: production row in normal flow.
  const v5 = ctx.buildRow('V5 flow', 0)
  v5.style.position = 'relative'
  v5.style.top = ''
  v5.style.height = `${ROW}px`
  add('v5-flow', v5)
  // V6: a plain block, absolutely placed, inline size (like the working probes).
  const v6 = document.createElement('div')
  v6.textContent = 'V6 block'
  Object.assign(v6.style, {
    position: 'absolute',
    left: '0px',
    width: '200px',
    height: `${ROW}px`,
    background: '#355'
  })
  add('v6-block', v6)
  // V7: production row without the pointer cursor.
  const v7 = ctx.buildRow('V7 no cursor', 0)
  v7.style.cursor = 'default'
  add('v7-nocursor', v7)
  // V8: production row with its spans in normal flow (no absolute parts).
  const v8 = ctx.buildRow('V8 flow parts', 0)
  for (const span of Array.from(v8.children) as HTMLElement[]) {
    span.style.position = 'static'
    span.style.display = 'inline-block'
    span.style.height = `${ROW}px`
  }
  add('v8-flowparts', v8)

  // Containers made at load, filled after load (the real rows are made after the catalog loads).
  const cleared = document.createElement('div')
  cleared.className = 'diag-cleared'
  Object.assign(cleared.style, { position: 'relative', height: `${ROW}px`, width: '200px' })
  cleared.append(ctx.buildRow('V10 before clear', 0))
  const reattached = document.createElement('div')
  reattached.className = 'diag-reattached'
  Object.assign(reattached.style, { position: 'relative', height: `${ROW}px`, width: '200px' })
  ctx.treePane.append(cleared)
  ctx.treePane.append(reattached)
  const lateBlock = (label: string): HTMLElement => {
    const node = document.createElement('div')
    node.textContent = label
    Object.assign(node.style, { width: '60px', height: '18px', background: '#575', margin: '2px' })
    return node
  }
  setTimeout(() => {
    // V9: a production row built well after load, into the strip.
    add('v9-late', ctx.buildRow('V9 late', 0))
    // V13: a plain block built late, into the strip.
    const block = lateBlock('V13 late block')
    Object.assign(block.style, {
      position: 'absolute',
      left: '0px',
      width: '200px',
      height: `${ROW}px`
    })
    add('v13-lateblock', block)
    // V10: the container is emptied and refilled, as the real tree does.
    cleared.textContent = ''
    add('v10-cleared', ctx.buildRow('V10 cleared', 0), cleared)
    // V11: the container is taken out of the tree and put back with a new row.
    reattached.remove()
    add('v11-reattached', ctx.buildRow('V11 reattached', 0), reattached)
    ctx.treePane.append(reattached)
    // V14: a block built late into the tree head (a flex row made at load).
    add('v14-head', lateBlock('V14'), ctx.treeHead)
    // V15: a block built late into the main toolbar.
    add('v15-toolbar', lateBlock('V15'), ctx.toolbar)
    log('late variants added')
  }, 3000)

  // Suspects left after rounds 1–3: a tall container, a row added in the same tick as the
  // folder menu and grid rebuild, a row added inside an animation frame, and the real spacer.
  const tall = document.createElement('div')
  tall.className = 'diag-tall'
  Object.assign(tall.style, { position: 'relative', height: `${ROW}px`, width: '200px' })
  const sameTick = document.createElement('div')
  sameTick.className = 'diag-sametick'
  Object.assign(sameTick.style, { position: 'relative', height: `${ROW}px`, width: '200px' })
  const inFrame = document.createElement('div')
  inFrame.className = 'diag-inframe'
  Object.assign(inFrame.style, { position: 'relative', height: `${ROW}px`, width: '200px' })
  ctx.treePane.append(tall)
  ctx.treePane.append(sameTick)
  ctx.treePane.append(inFrame)
  setTimeout(() => {
    // V16: the container gets a big height and a width in the same tick as its row.
    tall.style.height = `${ROW * 3}px`
    tall.style.width = '158px'
    tall.textContent = ''
    add('v16-tall', ctx.buildRow('V16 tall', 0), tall)
    // V17: a row added right before the folder menu and grid are rebuilt.
    sameTick.textContent = ''
    add('v17-sametick', ctx.buildRow('V17 same tick', 0), sameTick)
    ctx.rebuildMainPane()
    // V18: a row added inside an animation frame.
    requestAnimationFrame(() => {
      inFrame.textContent = ''
      add('v18-inframe', ctx.buildRow('V18 in frame', 0), inFrame)
      log('v18 added')
    })
    log('round 4 variants added')
  }, 6000)
}

export function installDiagnostics(ctx: DiagContext): void {
  context = ctx
  log(`diag start ${navigator.userAgent}`)
  rowVariants(ctx)

  // Probes in the tree head (dead area) and the toolbar (working area).
  ctx.treeHead.append(...probes('tree'))
  ctx.toolbar.append(...probes('toolbar'))

  // Three structures beside the tree: a scroll box like the tree, a plain box, and a column
  // wrapper holding a scroll box (the grid's shape).
  const scrollBox = alternativePane('scroll', { overflowY: 'auto', position: 'relative' })
  const plainBox = alternativePane('plain', {})
  const wrapper = document.createElement('div')
  wrapper.className = 'diag-column'
  Object.assign(wrapper.style, {
    width: '44px',
    flexShrink: '0',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '0'
  })
  const inner = alternativePane('column', { flex: '1', overflowY: 'auto', position: 'relative' })
  inner.style.width = ''
  wrapper.append(inner)
  const fixedHeight = alternativePane('fixed', { overflowY: 'auto', position: 'relative' })
  ctx.body.insertBefore(scrollBox, ctx.treePane)
  ctx.body.insertBefore(plainBox, ctx.treePane)
  ctx.body.insertBefore(wrapper, ctx.treePane)
  ctx.body.insertBefore(fixedHeight, ctx.treePane)

  // Every pointer event the document sees, with its target.
  let lastOver = ''
  for (const type of ['pointerdown', 'mousedown', 'click', 'mouseover']) {
    document.addEventListener(
      type,
      (event) => {
        const target = describe(event.target as Element | null)
        if (type === 'mouseover') {
          if (target === lastOver) return
          lastOver = target
        }
        log(
          `doc ${type} ${target} @${Math.round((event as MouseEvent).clientX)},${Math.round((event as MouseEvent).clientY)}`
        )
      },
      true
    )
  }

  const sample = (label: string): void => {
    const height = ctx.body.clientHeight || window.innerHeight
    fixedHeight.style.height = `${Math.max(100, height - 2)}px`
    log(`sample ${label} window ${window.innerWidth}x${window.innerHeight}`)
    const nodes: [string, HTMLElement][] = [
      ['body', ctx.body],
      ['tree', ctx.treePane],
      ['treeHead', ctx.treeHead],
      ['splitter', ctx.splitter],
      ['main', ctx.mainPane],
      ['toolbar', ctx.toolbar],
      ['grid', ctx.grid],
      ['scroll', scrollBox],
      ['plain', plainBox],
      ['column', inner],
      ['fixed', fixedHeight]
    ]
    for (const [name, node] of nodes) log(metrics(name, node))
    const xs = [10, 30, 56, 80, 104, 130, 160, 200, 260, 330, 400]
    const ys = [40, 70, 100, 150, 220, 300, 420]
    for (const y of ys) {
      const row: string[] = []
      for (const x of xs) {
        let hit = 'err'
        try {
          hit = describe(document.elementFromPoint(x, y))
        } catch (error) {
          hit = `err:${(error as Error).message}`
        }
        row.push(`${x},${y}=${hit}`)
      }
      log(`point ${row.join(' | ')}`)
    }
  }
  setTimeout(() => sample('1s'), 1000)
  setTimeout(() => sample('4s'), 4000)
  setTimeout(() => sample('10s'), 10_000)
}

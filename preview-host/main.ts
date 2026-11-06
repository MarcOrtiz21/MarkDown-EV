import 'katex/dist/katex.min.css'
import './preview.css'
import { renderMarkdown } from '../src/lib/markdown'
import { resolveImagePath } from '../src/lib/images'

type HostMessage =
  | { type: 'ready' }
  | { type: 'scroll'; line: number }
  | { type: 'task'; line: number; checked: boolean }
  | { type: 'link'; href: string }
  | { type: 'wikilink'; target: string }

declare global {
  interface Window {
    webkit?: { messageHandlers?: { mdev?: { postMessage: (message: HostMessage) => void } } }
    mdev: {
      render: (markdown: string, filePath: string) => { blocks: number; formulas: number }
      scrollToLine: (line: number) => void
      setAccent: (color: string) => void
      setStyle: (style: { font: 'system' | 'serif'; fontSize: number }) => void
      exportHTML: (title: string) => string
    }
  }
}

const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
const ZOOM_OUT_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>'
const ZOOM_IN_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5v14"/></svg>'
const FIT_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'

const root = document.getElementById('content') as HTMLElement
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
let suppressScrollUntil = 0
let lastMarkdown = ''
let lastFilePath = ''

function post(message: HostMessage) {
  window.webkit?.messageHandlers?.mdev?.postMessage(message)
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25

type Zoom = number | 'fit'

/** Zoom per diagram position, so re-rendering while typing keeps what the user chose. */
const diagramZoom = new Map<number, { zoom: Zoom; scrollLeft: number }>()

/** markdown-it wraps highlighted fences in `<pre><code>`; diagrams get their own frame instead. */
function frameDiagrams() {
  root.querySelectorAll<HTMLElement>('pre .mermaid').forEach((source, index) => {
    const pre = source.closest('pre')
    if (!pre) return
    const frame = document.createElement('div')
    frame.className = 'diagram'
    frame.dataset.index = String(index)
    const line = pre.dataset.line ?? pre.querySelector<HTMLElement>('[data-line]')?.dataset.line
    if (line) frame.dataset.line = line
    frame.append(source, diagramToolbar())
    pre.replaceWith(frame)
  })
}

function diagramToolbar() {
  const toolbar = document.createElement('div')
  toolbar.className = 'diagram-toolbar'
  toolbar.innerHTML = `
    <button type="button" data-zoom="out" title="Reducir (⌘ + rueda o pellizco)">${ZOOM_OUT_ICON}</button>
    <button type="button" data-zoom="reset" class="diagram-zoom-label" title="Tamaño real">100%</button>
    <button type="button" data-zoom="in" title="Ampliar (⌘ + rueda o pellizco)">${ZOOM_IN_ICON}</button>
    <button type="button" data-zoom="fit" title="Ajustar al ancho (doble clic)">${FIT_ICON}</button>`
  return toolbar
}

function naturalSize(svg: SVGSVGElement) {
  const box = svg.viewBox.baseVal
  if (box && box.width > 0) return { width: box.width, height: box.height }
  const rect = svg.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}

function diagramParts(frame: HTMLElement) {
  const viewport = frame.querySelector<HTMLElement>('.mermaid')
  const svg = viewport?.querySelector<SVGSVGElement>('svg')
  return viewport && svg ? { viewport, svg } : null
}

function resolvedScale(frame: HTMLElement, zoom: Zoom) {
  if (zoom !== 'fit') return zoom
  const parts = diagramParts(frame)
  if (!parts) return 1
  const available = parts.viewport.clientWidth - 2
  return Math.min(1, available / naturalSize(parts.svg).width)
}

function applyZoom(frame: HTMLElement, zoom: Zoom, anchor?: { x: number; y: number }) {
  const parts = diagramParts(frame)
  if (!parts) return
  const { viewport, svg } = parts
  const index = Number(frame.dataset.index)
  const before = svg.getBoundingClientRect()
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, resolvedScale(frame, zoom)))
  const size = naturalSize(svg)

  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.style.maxWidth = 'none'
  svg.style.width = `${size.width * scale}px`
  svg.style.height = `${size.height * scale}px`

  // Keep the point under the cursor (or the centre) still while zooming.
  if (anchor && before.width > 0) {
    const ratio = (size.width * scale) / before.width
    const after = svg.getBoundingClientRect()
    suppressScrollUntil = performance.now() + 250
    viewport.scrollLeft += after.left + (anchor.x - before.left) * ratio - anchor.x
    window.scrollBy(0, after.top + (anchor.y - before.top) * ratio - anchor.y)
  }

  frame.classList.toggle('is-pannable', viewport.scrollWidth > viewport.clientWidth)
  const label = frame.querySelector('.diagram-zoom-label')
  if (label) label.textContent = `${Math.round(scale * 100)}%`
  diagramZoom.set(index, { zoom: zoom === 'fit' ? 'fit' : scale, scrollLeft: viewport.scrollLeft })
}

function currentScale(frame: HTMLElement) {
  return resolvedScale(frame, diagramZoom.get(Number(frame.dataset.index))?.zoom ?? 1)
}

function zoomBy(frame: HTMLElement, factor: number, anchor?: { x: number; y: number }) {
  const center = frame.querySelector('svg')?.getBoundingClientRect()
  const point = anchor ?? (center ? { x: center.left + center.width / 2, y: center.top + center.height / 2 } : undefined)
  applyZoom(frame, currentScale(frame) * factor, point)
}

function restoreDiagrams() {
  root.querySelectorAll<HTMLElement>('.diagram').forEach((frame) => {
    const saved = diagramZoom.get(Number(frame.dataset.index))
    applyZoom(frame, saved?.zoom ?? 1)
    const viewport = frame.querySelector<HTMLElement>('.mermaid')
    if (viewport && saved) viewport.scrollLeft = saved.scrollLeft
  })
}

async function renderMermaid() {
  const nodes = root.querySelectorAll<HTMLElement>('.mermaid')
  if (nodes.length === 0) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    theme: darkQuery.matches ? 'dark' : 'neutral',
    securityLevel: 'strict',
    // Wide diagrams keep their natural size and scroll instead of shrinking to illegibility.
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
  })
  try {
    await mermaid.run({ nodes })
  } catch {
    // Syntax errors are expected while the user is still typing a diagram.
  }
  restoreDiagrams()
}

/** Parses into an inert template so images are not fetched before their paths are fixed. */
function buildContent(markdown: string, filePath: string) {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdown(markdown, filePath || null)
  // Raw HTML `<img>` tags bypass markdown-it's image rule, so resolve them here.
  template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    const src = image.getAttribute('src') ?? ''
    const resolved = resolveImagePath(src, filePath || null)
    if (resolved !== src) image.setAttribute('src', resolved)
  })
  return template.content
}

function decorate() {
  frameDiagrams()
  root.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach((checkbox) => {
    checkbox.disabled = false
    checkbox.setAttribute('aria-label', 'Marcar tarea')
  })
  root.querySelectorAll('pre').forEach((pre) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-copy-btn'
    button.title = 'Copiar código'
    button.innerHTML = COPY_ICON
    pre.appendChild(button)
  })
}

function render(markdown: string, filePath: string) {
  lastMarkdown = markdown
  lastFilePath = filePath
  root.replaceChildren(buildContent(markdown, filePath))
  decorate()
  void renderMermaid()
  return { blocks: root.childElementCount, formulas: root.querySelectorAll('.katex').length }
}

function lineElements() {
  return root.querySelectorAll<HTMLElement>('[data-line]')
}

function scrollToLine(line: number) {
  let best: HTMLElement | null = null
  let bestLine = -1
  for (const element of lineElements()) {
    const elementLine = Number.parseInt(element.dataset.line ?? '', 10)
    if (elementLine <= line && elementLine > bestLine) {
      best = element
      bestLine = elementLine
    }
  }
  suppressScrollUntil = performance.now() + 250
  const top = best ? best.getBoundingClientRect().top + window.scrollY - 16 : 0
  window.scrollTo({ top: Math.max(0, top) })
}

let scrollFrame = 0
window.addEventListener(
  'scroll',
  () => {
    if (scrollFrame) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      if (performance.now() < suppressScrollUntil) return
      const elements = lineElements()
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      let best: HTMLElement | null = atBottom ? elements[elements.length - 1] ?? null : null
      let bestDistance = atBottom ? -1 : Infinity
      for (const element of elements) {
        const distance = Math.abs(element.getBoundingClientRect().top - 16)
        if (distance < bestDistance) {
          bestDistance = distance
          best = element
        }
      }
      const line = Number.parseInt(best?.dataset.line ?? '', 10)
      if (!Number.isNaN(line)) post({ type: 'scroll', line })
    })
  },
  { passive: true },
)

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement

  const zoomButton = target.closest<HTMLButtonElement>('.diagram-toolbar button')
  const frame = zoomButton?.closest<HTMLElement>('.diagram')
  if (zoomButton && frame) {
    const action = zoomButton.dataset.zoom
    if (action === 'in') zoomBy(frame, ZOOM_STEP)
    else if (action === 'out') zoomBy(frame, 1 / ZOOM_STEP)
    else applyZoom(frame, action === 'fit' ? 'fit' : 1)
    return
  }

  const copyButton = target.closest<HTMLButtonElement>('.code-copy-btn')
  if (copyButton) {
    const code = copyButton.closest('pre')?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code).then(() => {
      copyButton.innerHTML = CHECK_ICON
      copyButton.classList.add('copied')
      setTimeout(() => {
        copyButton.innerHTML = COPY_ICON
        copyButton.classList.remove('copied')
      }, 1600)
    })
    return
  }

  const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]')
  if (checkbox) {
    event.preventDefault()
    const line = Number.parseInt(checkbox.closest<HTMLElement>('[data-line]')?.dataset.line ?? '', 10)
    if (!Number.isNaN(line)) post({ type: 'task', line, checked: !checkbox.checked })
    return
  }

  const anchor = target.closest('a')
  const href = anchor?.getAttribute('href')
  if (!anchor || !href) return
  event.preventDefault()

  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView()
  } else if (href.startsWith('wikilink:')) {
    post({ type: 'wikilink', target: anchor.dataset.target ?? '' })
  } else {
    post({ type: 'link', href })
  }
})

function diagramAt(target: EventTarget | null) {
  const element = target as Element | null
  if (!element?.closest || element.closest('.diagram-toolbar')) return null
  return element.closest<HTMLElement>('.diagram')
}

root.addEventListener('dblclick', (event) => {
  const frame = diagramAt(event.target)
  if (!frame) return
  event.preventDefault()
  const isFit = diagramZoom.get(Number(frame.dataset.index))?.zoom === 'fit'
  applyZoom(frame, isFit ? 1 : 'fit')
})

// ⌘/Ctrl + wheel; WebKit also reports some trackpad pinches this way.
root.addEventListener(
  'wheel',
  (event) => {
    const frame = diagramAt(event.target)
    if (!frame || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    zoomBy(frame, Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY })
  },
  { passive: false },
)

// Trackpad pinch arrives as WebKit gesture events, with a cumulative scale.
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number }
let pinch: { frame: HTMLElement; startScale: number } | null = null
root.addEventListener('gesturestart', (event) => {
  const frame = diagramAt(event.target)
  if (!frame) return
  event.preventDefault()
  pinch = { frame, startScale: currentScale(frame) }
})
root.addEventListener('gesturechange', (event) => {
  if (!pinch) return
  const gesture = event as GestureEvent
  event.preventDefault()
  applyZoom(pinch.frame, pinch.startScale * gesture.scale, { x: gesture.clientX, y: gesture.clientY })
})
root.addEventListener('gestureend', () => {
  pinch = null
})

let pan: { viewport: HTMLElement; x: number; y: number; scrollLeft: number; pointer: number } | null = null
root.addEventListener('pointerdown', (event) => {
  const frame = diagramAt(event.target)
  const viewport = frame?.querySelector<HTMLElement>('.mermaid')
  if (!frame?.classList.contains('is-pannable') || !viewport || event.button !== 0) return
  pan = { viewport, x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, pointer: event.pointerId }
  viewport.setPointerCapture(event.pointerId)
  frame.classList.add('is-panning')
  event.preventDefault()
})
root.addEventListener('pointermove', (event) => {
  if (!pan || event.pointerId !== pan.pointer) return
  pan.viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.x)
  window.scrollBy(0, pan.y - event.clientY)
  pan.y = event.clientY
})
function endPan(event: PointerEvent) {
  if (!pan || event.pointerId !== pan.pointer) return
  const frame = pan.viewport.closest<HTMLElement>('.diagram')
  frame?.classList.remove('is-panning')
  const index = Number(frame?.dataset.index)
  const saved = diagramZoom.get(index)
  if (saved) saved.scrollLeft = pan.viewport.scrollLeft
  pan = null
}
root.addEventListener('pointerup', endPan)
root.addEventListener('pointercancel', endPan)

let resizeFrame = 0
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    root.querySelectorAll<HTMLElement>('.diagram').forEach((frame) => {
      applyZoom(frame, diagramZoom.get(Number(frame.dataset.index))?.zoom ?? 1)
    })
  })
})

darkQuery.addEventListener('change', () => render(lastMarkdown, lastFilePath))

function setAccent(color: string) {
  document.documentElement.style.setProperty('--accent', color)
}

function setStyle(style: { font: 'system' | 'serif'; fontSize: number }) {
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--preview-font', style.font === 'serif' ? 'var(--font-serif)' : 'var(--font-system)')
  rootStyle.setProperty('--preview-font-size', `${style.fontSize}px`)
}

function escapeHTML(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/**
 * Standalone HTML of the current render. Formulas keep only their MathML, which
 * browsers draw natively, so the KaTeX fonts are not needed outside the app.
 */
function exportHTML(title: string) {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.code-copy-btn, .katex-html, .diagram-toolbar').forEach((element) => element.remove())
  clone.querySelectorAll<SVGSVGElement>('.diagram svg').forEach((svg) => {
    svg.style.width = `${naturalSize(svg).width}px`
    svg.style.maxWidth = '100%'
    svg.style.height = 'auto'
  })
  clone.querySelectorAll('input.task-list-item-checkbox').forEach((checkbox) => checkbox.setAttribute('disabled', ''))
  clone.querySelectorAll('[data-line]').forEach((element) => element.removeAttribute('data-line'))

  const css = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })
    .filter((rule) => !(rule instanceof CSSFontFaceRule) && !rule.cssText.includes('.katex'))
    .map((rule) => rule.cssText)
    .join('\n')
  const rootStyle = document.documentElement.style.cssText

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MarkDown EV">
<title>${escapeHTML(title)}</title>
<style>
${css}
:root { ${rootStyle} }
math[display="block"] { display: block; margin: 0.6em 0; overflow-x: auto; }
</style>
</head>
<body>
<article class="markdown-preview">
${clone.innerHTML}
</article>
</body>
</html>
`
}

window.mdev = { render, scrollToLine, setAccent, setStyle, exportHTML }
post({ type: 'ready' })

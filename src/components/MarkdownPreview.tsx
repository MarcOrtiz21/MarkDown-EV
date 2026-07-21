import { useCallback, useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { getElectronAPI, hasElectronAPI } from '../lib/electron'
import type { Theme } from '../lib/theme'
import mermaid from 'mermaid'

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
})

type MarkdownPreviewProps = {
  content: string
  filePath: string | null
  theme?: Theme
  onScroll?: (sourceLine: number) => void
  previewRef?: React.MutableRefObject<{ scrollToLine: (line: number) => void } | null>
  onWikiLinkClick?: (noteName: string) => void
}

export function MarkdownPreview({
  content,
  filePath,
  theme = 'dark',
  onScroll,
  previewRef,
  onWikiLinkClick,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(content, filePath), [content, filePath])
  const onScrollRef = useRef(onScroll)

  useEffect(() => {
    onScrollRef.current = onScroll
  }, [onScroll])

  // Set HTML content, run mermaid rendering, and add copy-code buttons
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = html

    // Re-initialize mermaid with current theme
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
    })

    // Render mermaid diagrams
    const mermaidNodes = container.querySelectorAll<HTMLElement>('.mermaid')
    if (mermaidNodes.length > 0) {
      mermaid.run({
        nodes: mermaidNodes,
      }).catch(() => {
        // Silent catch for syntax errors while typing
      })
    }

    // Add copy-code buttons to each pre block
    const preElements = container.querySelectorAll('pre')
    preElements.forEach((pre) => {
      if (pre.querySelector('.code-copy-btn')) return
      
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy-btn'
      btn.title = 'Copiar código'
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`
      
      pre.style.position = 'relative'
      pre.appendChild(btn)
    })
  }, [html, theme])

  // Handle delegated click events (external links + code copying)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // 1. Handle copy button click
      const copyBtn = target.closest('.code-copy-btn')
      if (copyBtn) {
        const pre = copyBtn.closest('pre')
        if (pre) {
          const codeText = pre.querySelector('code')?.textContent || ''
          navigator.clipboard.writeText(codeText).then(() => {
            // Checkmark SVG
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`
            copyBtn.classList.add('copied')
            setTimeout(() => {
              // Copy icon SVG
              copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`
              copyBtn.classList.remove('copied')
            }, 2000)
          }).catch(() => {})
        }
        return
      }

      // 2. Handle links click (external + wikilinks)
      const anchor = target.closest('a')
      if (anchor) {
        const href = anchor.getAttribute('href')
        if (href) {
          if (/^https?:\/\//i.test(href)) {
            event.preventDefault()
            if (hasElectronAPI()) {
              void getElectronAPI().openExternal(href)
            }
          } else if (href.startsWith('wikilink:')) {
            event.preventDefault()
            const dataTarget = anchor.getAttribute('data-target') || ''
            if (onWikiLinkClick) {
              onWikiLinkClick(dataTarget)
            }
          }
        }
      }
    }

    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [onWikiLinkClick])

  // Expose imperative scrollToLine
  useEffect(() => {
    if (!previewRef) return
    previewRef.current = {
      scrollToLine(line: number) {
        const container = containerRef.current
        if (!container) return
        const scrollParent = container.closest('.pane--preview')
        if (!scrollParent) return

        const elements = container.querySelectorAll<HTMLElement>('[data-line]')
        let best: HTMLElement | null = null
        let bestLine = -1

        for (const el of elements) {
          const elLine = parseInt(el.dataset.line ?? '', 10)
          if (isNaN(elLine)) continue
          if (elLine <= line && elLine > bestLine) {
            best = el
            bestLine = elLine
          }
        }

        if (best) {
          const containerTop = scrollParent.getBoundingClientRect().top
          const elementTop = best.getBoundingClientRect().top
          scrollParent.scrollTop += elementTop - containerTop
        }
      },
    }
    return () => {
      previewRef.current = null
    }
  }, [previewRef])

  // Scroll event
  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const callback = onScrollRef.current
    if (!callback) return

    const scrollParent = container.closest('.pane--preview')
    if (!scrollParent) return

    const containerRect = scrollParent.getBoundingClientRect()
    const topY = containerRect.top + 10

    const elements = container.querySelectorAll<HTMLElement>('[data-line]')
    let best: HTMLElement | null = null
    let bestDist = Infinity

    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      const dist = Math.abs(rect.top - topY)
      if (dist < bestDist) {
        bestDist = dist
        best = el
      }
    }

    if (best) {
      const line = parseInt(best.dataset.line ?? '', 10)
      if (!isNaN(line)) {
        callback(line)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="markdown-preview prose"
      onScroll={handleScroll}
    />
  )
}

import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import { katex as katexPlugin } from '@mdit/plugin-katex'
import footnotePlugin from 'markdown-it-footnote'
import taskListsPlugin from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/core'

// Register only common languages to keep the bundle smaller
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import latex from 'highlight.js/lib/languages/latex'
import r from 'highlight.js/lib/languages/r'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'

import { resolveImagePath } from './images'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('latex', latex)
hljs.registerLanguage('tex', latex)
hljs.registerLanguage('r', r)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('kt', kotlin)

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    if (lang === 'mermaid') {
      return `<div class="mermaid">${str}</div>`
    }
    const language = lang && hljs.getLanguage(lang) ? lang : null
    if (language) {
      try {
        const result = hljs.highlight(str, { language })
        return `<pre><code class="hljs language-${language}" data-language="${language}">${result.value}</code></pre>`
      } catch {
        // fall through
      }
    }
    // No language or highlight error — return escaped HTML in a plain block
    return `<pre><code class="hljs">${MarkdownIt().utils.escapeHtml(str)}</code></pre>`
  },
})

// KaTeX plugin — renders math BEFORE markdown rules can mangle $ and _
katexPlugin(md, {
  throwOnError: false,
  errorColor: '#cc6666',
  output: 'htmlAndMathml',
})

md.use(footnotePlugin)
md.use(taskListsPlugin, { label: true, labelAfter: true })

// Obsidian-Style WikiLinks inline rule: [[Note Name]] or [[Note Name|Custom Text]]
md.inline.ruler.after('link', 'wikilink', (state, silent) => {
  const max = state.posMax
  const start = state.pos

  if (start + 4 > max) return false
  if (state.src.charCodeAt(start) !== 0x5B /* [ */ || state.src.charCodeAt(start + 1) !== 0x5B /* [ */) {
    return false
  }

  // Find the closing ']]'
  let matchStart = start + 2
  let matchEnd = -1
  for (let i = matchStart; i < max - 1; i++) {
    if (state.src.charCodeAt(i) === 0x5D /* ] */ && state.src.charCodeAt(i + 1) === 0x5D /* ] */) {
      matchEnd = i
      break
    }
  }

  if (matchEnd === -1) return false

  const content = state.src.substring(matchStart, matchEnd).trim()
  if (!content) return false

  if (!silent) {
    let target = content
    let text = content

    const pipeIdx = content.indexOf('|')
    if (pipeIdx !== -1) {
      target = content.substring(0, pipeIdx).trim()
      text = content.substring(pipeIdx + 1).trim()
    }

    const token_open = state.push('wikilink_open', 'a', 1)
    token_open.attrs = [
      ['href', `wikilink:${encodeURIComponent(target)}`],
      ['class', 'wikilink-anchor'],
      ['data-target', target]
    ]

    const token_text = state.push('text', '', 0)
    token_text.content = text

    state.push('wikilink_close', 'a', -1)
  }

  state.pos = matchEnd + 2
  return true
})


// Heading IDs slug generation for TOC Outline navigation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.renderer.rules.heading_open = (tokens: Token[], idx: number, options: any, _env: any, self: any) => {
  const token = tokens[idx]
  const nextToken = tokens[idx + 1]
  if (nextToken && nextToken.type === 'inline') {
    const slug = nextToken.content
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
    token.attrSet('id', slug)
  }
  return self.renderToken(tokens, idx, options)
}

// ---------- data-line injection for scroll sync ----------

// We want each block-level token that maps to a source line to carry
// a `data-line` attribute so the preview can be scroll-synced with
// the editor.

const BLOCK_TYPES_WITH_LINES = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'ordered_list_open',
  'bullet_list_open',
  'table_open',
  'hr',
  'fence',
  'code_block',
  'html_block',
])

function injectDataLine() {
  md.core.ruler.push('data_line', (state: StateCore) => {
    for (const token of state.tokens) {
      if (token.map && BLOCK_TYPES_WITH_LINES.has(token.type)) {
        const line = token.map[0]
        token.attrSet('data-line', String(line))
      }
    }
  })
}

injectDataLine()

// ---------- image path resolution ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultImageRule: (tokens: Token[], idx: number, options: any, env: any, self: any) => string =
  md.renderer.rules.image ??
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((tokens: Token[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.renderer.rules.image = (tokens: Token[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx]
  const src = token.attrGet('src')
  const filePath = (env as { filePath?: string | null }).filePath ?? null

  if (src) {
    token.attrSet('src', resolveImagePath(src, filePath))
  }

  return defaultImageRule(tokens, idx, options, env, self)
}

// ---------- public API ----------

export function renderMarkdown(content: string, filePath: string | null = null): string {
  return md.render(content, { filePath })
}

import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('sanitizes executable HTML while keeping Markdown content', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">\n\n**seguro**')

    expect(html).not.toContain('onerror')
    expect(html).toContain('<strong>seguro</strong>')
  })

  it('blocks dangerous URL schemes while preserving safe links', () => {
    const html = renderMarkdown(
      '<a href="javascript:alert(1)">ejecuta</a> ' +
        '<a href="file:///etc/passwd">archivo</a> ' +
        '<a href="https://example.com">seguro</a> ' +
        '<img src="data:image/png;base64,abc" alt="imagen">',
    )

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('file:///etc/passwd')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('src="data:image/png;base64,abc"')
  })

  it('creates unique heading ids', () => {
    const html = renderMarkdown('# Introducción\n\n# Introducción\n\n# Café')

    expect(html).toContain('id="introduccion"')
    expect(html).toContain('id="introduccion-1"')
    expect(html).toContain('id="cafe"')
  })

  it('renders task list metadata with source lines', () => {
    const html = renderMarkdown('- [ ] Pendiente')

    expect(html).toContain('task-list-item-checkbox')
    expect(html).toContain('data-line="0"')
  })
})

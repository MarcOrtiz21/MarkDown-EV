import { describe, expect, it } from 'vitest'
import { prepareExportHtml } from './pdf'

describe('prepareExportHtml', () => {
  it('converts Mermaid blocks into SVG for exports', async () => {
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    })

    const html = await prepareExportHtml(
      '```mermaid\nflowchart LR\n  A[Inicio] --> B[Fin]\n```',
      null,
      async () => null,
    )

    expect(html).toContain('<svg')
    expect(html).not.toContain('<div class="mermaid">')
  })
})

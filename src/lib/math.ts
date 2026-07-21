// LaTeX math rendering is now handled directly by @mdit/plugin-katex
// inside markdown.ts. This module is kept as a no-op for backwards
// compatibility with any imports that still reference it.

/**
 * @deprecated KaTeX rendering is now integrated into the markdown-it
 * pipeline via @mdit/plugin-katex. This function returns the HTML as-is.
 */
export function renderMathInHtml(html: string): string {
  return html
}

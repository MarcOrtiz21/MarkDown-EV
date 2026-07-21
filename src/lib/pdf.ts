import { renderMarkdown } from './markdown'

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 12pt;
    line-height: 1.65;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    padding: 48px 56px;
  }
  h1, h2, h3, h4 { font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.5em; color: #111; }
  h1 { font-size: 22pt; border-bottom: 1px solid #ddd; padding-bottom: 0.25em; }
  h2 { font-size: 16pt; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  h3 { font-size: 13pt; }
  p { margin: 0.7em 0; }
  a { color: #5b4cdb; text-decoration: none; }
  code {
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.88em;
    background: #f4f4f5;
    padding: 0.12em 0.35em;
    border-radius: 4px;
  }
  pre {
    background: #f8f8f8;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 14px;
    overflow-x: auto;
    font-size: 10pt;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    margin: 1em 0;
    padding: 0.3em 0 0.3em 1em;
    border-left: 3px solid #7f6df2;
    color: #555;
  }
  ul, ol { padding-left: 1.4em; margin: 0.7em 0; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 10pt; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.8em 0; }
  img { max-width: 100%; border-radius: 4px; }
  .katex-display { overflow-x: auto; padding: 0.4em 0; }
`

/**
 * Build a self-contained HTML document for PDF export.
 * `katexCss` is the contents of katex.min.css, injected inline so
 * the PDF works without an internet connection.
 */
export function buildPdfDocument(bodyHtml: string, katexCss?: string): string {
  const katexStyleBlock = katexCss
    ? `<style>${katexCss}</style>`
    : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css" />`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  ${katexStyleBlock}
  <style>${PRINT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`
}

export async function prepareExportHtml(
  content: string,
  filePath: string | null,
  resolveImage: (absolutePath: string) => Promise<string | null>,
): Promise<string> {
  let html = renderMarkdown(content, filePath)

  const matches = [...html.matchAll(/src="(app-image:\/\/[^"]+)"/g)]
  for (const match of matches) {
    const appUrl = match[1]
    const absolutePath = decodeURIComponent(appUrl.slice('app-image://'.length))
    const dataUrl = await resolveImage(absolutePath)
    if (dataUrl) {
      html = html.replace(match[0], `src="${dataUrl}"`)
    }
  }

  // Read local KaTeX CSS if available via Electron IPC
  let katexCss: string | undefined
  try {
    const { getElectronAPI, hasElectronAPI } = await import('./electron')
    if (hasElectronAPI()) {
      katexCss = (await getElectronAPI().readKatexCss()) ?? undefined
    }
  } catch {
    // Running outside Electron or IPC not available — fall back to CDN link
  }

  return buildPdfDocument(html, katexCss)
}

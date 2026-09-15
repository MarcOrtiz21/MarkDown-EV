import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(projectRoot, 'public')
const buildDir = join(projectRoot, 'build')

// Keep the mark opaque and high-contrast so it remains legible on dark macOS
// surfaces, browser tabs, and the application toolbar.
const logoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">MarkDown EV</title>
  <desc id="desc">Una M de Markdown con una flecha descendente</desc>
  <rect width="512" height="512" rx="112" fill="#5B16B8"/>
  <!-- One continuous rounded mark: the M descends directly into the arrow. -->
  <path d="M120 372V150C120 130 145 122 158 138L230 224L302 138C315 122 340 130 340 150V398M286 340L340 402L394 340" fill="none" stroke="#FFFFFF" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`

const faviconSvg = logoSvg.replace('width="512" height="512"', 'width="32" height="32"')

mkdirSync(publicDir, { recursive: true })
mkdirSync(buildDir, { recursive: true })
writeFileSync(join(publicDir, 'logo.svg'), logoSvg)
writeFileSync(join(publicDir, 'favicon.svg'), faviconSvg)

if (process.platform === 'darwin') {
  const tempDir = mkdtempSync(join(tmpdir(), 'markdown-ev-logo-'))
  try {
    const sourceSvg = join(tempDir, 'logo.svg')
    writeFileSync(sourceSvg, logoSvg)

    // macOS ships sips and iconutil, so the raster and .icns outputs stay
    // reproducible without introducing a photo/AI asset or another dependency.
    const pngPath = join(buildDir, 'icon.png')
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', '512', '512', sourceSvg, '--out', pngPath], { stdio: 'ignore' })

    const iconsetDir = join(tempDir, 'MarkDown EV.iconset')
    mkdirSync(iconsetDir)
    for (const size of [16, 32, 128, 256, 512]) {
      const standard = join(iconsetDir, `icon_${size}x${size}.png`)
      const retina = join(iconsetDir, `icon_${size}x${size}@2x.png`)
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourceSvg, '--out', standard], { stdio: 'ignore' })
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size * 2), String(size * 2), sourceSvg, '--out', retina], { stdio: 'ignore' })
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')], { stdio: 'ignore' })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
} else {
  console.log('SVG del logo generado; PNG/ICNS se conservan para empaquetados macOS.')
}

// Keep this output useful in CI and when the asset is regenerated manually.
const generated = readFileSync(join(publicDir, 'logo.svg'), 'utf8')
console.log(`Logo generado (${generated.length} bytes SVG, ${join(buildDir, 'icon.icns')})`)

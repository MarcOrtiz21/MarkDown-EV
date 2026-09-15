export function getBaseDir(filePath: string | null): string | null {
  if (!filePath) return null
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : null
}

export function resolveImagePath(src: string, filePath: string | null): string {
  if (!src || /^(https?:|data:|app-image:)/i.test(src)) return src
  if (!filePath) return src

  const baseDir = getBaseDir(filePath)
  if (!baseDir) return src

  if (src.startsWith('/') || /^[A-Za-z]:/.test(src)) {
    return toAppImageUrl(src.replace(/\\/g, '/'))
  }

  const clean = src.replace(/^\.\//, '')
  return toAppImageUrl(`${baseDir}/${clean}`)
}

export function toAppImageUrl(absolutePath: string): string {
  // Keep a valid URI authority. Encoding the absolute path immediately after
  // `//` makes it look like a hostname to Chromium and breaks local images.
  return `app-image://local/${encodeURIComponent(absolutePath.replace(/\\/g, '/'))}`
}

export function fromAppImageUrl(url: string): string | null {
  if (!url.startsWith('app-image://')) return null
  const payload = url.slice('app-image://'.length)
  const encodedPath = payload.startsWith('local/') ? payload.slice('local/'.length) : payload
  return decodeURIComponent(encodedPath)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|txt)$/i

export function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXT.test(filePath)
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXT.test(filePath)
}

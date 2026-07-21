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
  return `app-image://${encodeURIComponent(absolutePath)}`
}

export function fromAppImageUrl(url: string): string | null {
  if (!url.startsWith('app-image://')) return null
  return decodeURIComponent(url.slice('app-image://'.length))
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i

export function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(filePath)
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXT.test(filePath)
}

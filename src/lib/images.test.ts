import { describe, expect, it } from 'vitest'
import { fromAppImageUrl, getBaseDir, isImageFile, isMarkdownFile, resolveImagePath } from './images'

describe('image and file path helpers', () => {
  it('resolves relative images next to the document', () => {
    expect(resolveImagePath('./assets/photo.png', '/docs/note.md')).toBe(
      'app-image://local/%2Fdocs%2Fassets%2Fphoto.png',
    )
    expect(fromAppImageUrl('app-image://local/%2Fdocs%2Fassets%2Fphoto.png')).toBe('/docs/assets/photo.png')
  })

  it('preserves remote and data URLs', () => {
    expect(resolveImagePath('https://example.com/photo.png', '/docs/note.md')).toBe(
      'https://example.com/photo.png',
    )
    expect(resolveImagePath('data:image/png;base64,abc', '/docs/note.md')).toBe(
      'data:image/png;base64,abc',
    )
  })

  it('recognizes supported document and image extensions', () => {
    expect(isMarkdownFile('/docs/note.markdown')).toBe(true)
    expect(isMarkdownFile('/docs/note.mdown')).toBe(true)
    expect(isMarkdownFile('/docs/note.mkd')).toBe(true)
    expect(isMarkdownFile('/docs/note.txt')).toBe(true)
    expect(isMarkdownFile('/docs/photo.png')).toBe(false)
    expect(isImageFile('/docs/photo.webp')).toBe(true)
    expect(isImageFile('/docs/photo.pdf')).toBe(false)
    expect(getBaseDir('/docs/note.md')).toBe('/docs')
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabBar, type Tab } from './TabBar'

afterEach(cleanup)

const tabs: Tab[] = [
  {
    id: '/docs/nota.md',
    filePath: '/docs/nota.md',
    content: '# Nota',
    savedContent: '# Nota',
  },
  {
    id: 'draft',
    filePath: null,
    content: 'Borrador',
    savedContent: '',
  },
]

describe('TabBar', () => {
  it('marks the active tab and closes the requested tab', () => {
    const onTabClose = vi.fn()

    render(
      <TabBar
        tabs={tabs}
        activeTabId="/docs/nota.md"
        onTabSelect={vi.fn()}
        onTabClose={onTabClose}
      />,
    )

    const activeTab = screen.getByRole('tab', { name: /nota\.md/ })
    expect(activeTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar nota.md' }))
    expect(onTabClose).toHaveBeenCalledWith('/docs/nota.md')
  })

  it('selects a tab from the keyboard', () => {
    const onTabSelect = vi.fn()

    render(
      <TabBar
        tabs={tabs}
        activeTabId="/docs/nota.md"
        onTabSelect={onTabSelect}
        onTabClose={vi.fn()}
      />,
    )

    fireEvent.keyDown(screen.getByRole('tab', { name: /Sin título/ }), { key: 'Enter' })
    expect(onTabSelect).toHaveBeenCalledWith('draft')
  })
})

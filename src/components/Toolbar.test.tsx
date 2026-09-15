import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

describe('Toolbar', () => {
  it('expone las acciones principales y reenvía sus eventos', () => {
    const handlers = {
      onOpen: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onExportPdf: vi.fn(),
      onExportHtml: vi.fn(),
      onCopyRichText: vi.fn(),
      onThemeToggle: vi.fn(),
      onFocusModeToggle: vi.fn(),
      onViewModeChange: vi.fn(),
      onSettingsOpen: vi.fn(),
      onSidebarToggle: vi.fn(),
    }

    render(
      <Toolbar
        fileName="/docs/nota.md"
        isDirty
        viewMode="split"
        theme="dark"
        {...handlers}
      />,
    )

    expect(screen.getByText('nota.md •')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como' }))
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar Rich Text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preferencias' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar menú lateral' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enfoque' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }))

    expect(handlers.onOpen).toHaveBeenCalledOnce()
    expect(handlers.onSave).toHaveBeenCalledOnce()
    expect(handlers.onSaveAs).toHaveBeenCalledOnce()
    expect(handlers.onExportPdf).toHaveBeenCalledOnce()
    expect(handlers.onExportHtml).toHaveBeenCalledOnce()
    expect(handlers.onCopyRichText).toHaveBeenCalledOnce()
    expect(handlers.onSettingsOpen).toHaveBeenCalledOnce()
    expect(handlers.onSidebarToggle).toHaveBeenCalledOnce()
    expect(handlers.onFocusModeToggle).toHaveBeenCalledOnce()
    expect(handlers.onViewModeChange).toHaveBeenCalledWith('edit')
  })
})

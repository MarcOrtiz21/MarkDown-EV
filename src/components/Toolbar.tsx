import type { Theme } from '../lib/theme'
import { SunIcon, MoonIcon, FileIcon, SettingsIcon, SidebarToggleIcon } from './Icons'

export type ViewMode = 'edit' | 'split' | 'preview'

type DropOverlayProps = {
  visible: boolean
}

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null

  return (
    <div className="drop-overlay">
      <div className="drop-overlay__content">
        <FileIcon className="drop-overlay__icon" size={48} />
        <p>Suelta el archivo .md para abrirlo</p>
      </div>
    </div>
  )
}

type ToolbarProps = {
  fileName: string | null
  isDirty: boolean
  viewMode: ViewMode
  theme: Theme
  focusMode?: boolean
  isSidebarOpen?: boolean
  onSidebarToggle?: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExportPdf: () => void
  onExportHtml?: () => void
  onCopyRichText?: () => void
  onThemeToggle: () => void
  onFocusModeToggle?: () => void
  onViewModeChange: (mode: ViewMode) => void
  onSettingsOpen: () => void
}

const viewModes: { mode: ViewMode; label: string; shortcut: string }[] = [
  { mode: 'split', label: 'Dividido', shortcut: '⌘2' },
  { mode: 'edit', label: 'Editor', shortcut: '⌘1' },
  { mode: 'preview', label: 'Vista previa', shortcut: '⌘3' },
]

export function Toolbar({
  fileName,
  isDirty,
  viewMode,
  theme,
  focusMode = false,
  isSidebarOpen = true,
  onSidebarToggle,
  onOpen,
  onSave,
  onSaveAs,
  onExportPdf,
  onExportHtml,
  onCopyRichText,
  onThemeToggle,
  onFocusModeToggle,
  onViewModeChange,
  onSettingsOpen,
}: ToolbarProps) {
  const title = fileName
    ? fileName.split(/[/\\]/).pop() + (isDirty ? ' •' : '')
    : 'Sin título'

  return (
    <header className="toolbar">
      <div className="toolbar-drag" />

      <div className="toolbar-left">
        {onSidebarToggle && (
          <button
            type="button"
            className={`action-btn action-btn--icon ${isSidebarOpen ? 'action-btn--accent' : ''}`}
            onClick={onSidebarToggle}
            title={isSidebarOpen ? 'Ocultar menú lateral' : 'Mostrar menú lateral (Archivos/Esquema/Buscar)'}
          >
            <SidebarToggleIcon size={14} />
          </button>
        )}
        <span className="app-name">MarkDown EV</span>
        <span className="file-name">{title}</span>
      </div>

      <div className="toolbar-center">
        {viewModes.map(({ mode, label, shortcut }) => (
          <button
            key={mode}
            type="button"
            className={`view-btn ${viewMode === mode ? 'active' : ''}`}
            onClick={() => onViewModeChange(mode)}
            title={`${label} (${shortcut})`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar-right">
        {onFocusModeToggle && (
          <button
            type="button"
            className={`action-btn ${focusMode ? 'action-btn--accent' : ''}`}
            onClick={onFocusModeToggle}
            title="Alternar Modo Enfoque"
          >
            Enfoque
          </button>
        )}
        {onCopyRichText && (
          <button
            type="button"
            className="action-btn"
            onClick={onCopyRichText}
            title="Copiar contenido con formato enriquecido para pegar en Mail/Word/Slack"
          >
            Copiar Rich Text
          </button>
        )}
        <button
          type="button"
          className="action-btn action-btn--icon"
          onClick={onThemeToggle}
          title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        >
          {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
        </button>
        <button
          type="button"
          className="action-btn action-btn--icon"
          onClick={onSettingsOpen}
          title="Preferencias"
        >
          <SettingsIcon size={14} />
        </button>
        <button type="button" className="action-btn" onClick={onOpen} title="Abrir (⌘O)">
          Abrir
        </button>
        <button type="button" className="action-btn" onClick={onSave} title="Guardar (⌘S)">
          Guardar
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={onSaveAs}
          title="Guardar como (⌘⇧S)"
        >
          Guardar como
        </button>
        {onExportHtml && (
          <button
            type="button"
            className="action-btn"
            onClick={onExportHtml}
            title="Exportar archivo HTML completo"
          >
            HTML
          </button>
        )}
        <button
          type="button"
          className="action-btn action-btn--accent"
          onClick={onExportPdf}
          title="Exportar PDF (⌘P)"
        >
          PDF
        </button>
      </div>
    </header>
  )
}


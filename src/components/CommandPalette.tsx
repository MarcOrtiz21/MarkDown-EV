import { useEffect, useRef, useState, useMemo } from 'react'
import { getElectronAPI, hasElectronAPI } from '../lib/electron'
import type { WorkspaceFile } from '../types/electron'
import { FileIcon, SearchIcon } from './Icons'

type CommandPaletteProps = {
  isOpen: boolean
  mode: 'file' | 'command'
  workspacePath: string | null
  onClose: () => void
  onOpenFile: (filePath: string) => void
  onExecuteCommand: (action: string) => void
}

type CommandOption = {
  id: string
  name: string
  shortcut?: string
  action: string
}

const COMMAND_OPTIONS: CommandOption[] = [
  { id: 'new-file', name: 'Crear nuevo archivo', action: 'new-file' },
  { id: 'open-folder', name: 'Abrir carpeta de trabajo...', action: 'open-folder' },
  { id: 'save-file', name: 'Guardar archivo activo', shortcut: '⌘S', action: 'save-file' },
  { id: 'save-as', name: 'Guardar archivo como...', shortcut: '⌘⇧S', action: 'save-as' },
  { id: 'export-pdf', name: 'Exportar documento a PDF', shortcut: '⌘P', action: 'export-pdf' },
  { id: 'theme-toggle', name: 'Alternar Tema Claro / Oscuro', action: 'theme-toggle' },
  { id: 'view-edit', name: 'Establecer vista: Solo Editor', shortcut: '⌘1', action: 'view-edit' },
  { id: 'view-split', name: 'Establecer vista: Dividida', shortcut: '⌘2', action: 'view-split' },
  { id: 'view-preview', name: 'Establecer vista: Solo Vista Previa', shortcut: '⌘3', action: 'view-preview' },
  { id: 'close-tab', name: 'Cerrar pestaña activa', shortcut: '⌘W', action: 'close-tab' },
]

export function CommandPalette({
  isOpen,
  mode,
  workspacePath,
  onClose,
  onOpenFile,
  onExecuteCommand,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Initialize query and load files when palette is opened
  useEffect(() => {
    if (isOpen) {
      setQuery(mode === 'command' ? '>' : '')
      setSelectedIndex(0)
      
      // Focus input field immediately
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)

      // Load workspace files for file search mode
      if (workspacePath && hasElectronAPI()) {
        getElectronAPI()
          .getAllFiles(workspacePath)
          .then((files) => {
            setWorkspaceFiles(files)
          })
          .catch(() => {})
      } else {
        setWorkspaceFiles([])
      }
    }
  }, [isOpen, mode, workspacePath])

  // Determine current active mode (typing '>' changes to command mode dynamically)
  const isCommandMode = query.startsWith('>')
  const searchString = isCommandMode ? query.slice(1).trim() : query.trim()

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (isCommandMode) {
      // Filter commands
      if (!searchString) return COMMAND_OPTIONS
      return COMMAND_OPTIONS.filter((cmd) =>
        cmd.name.toLowerCase().includes(searchString.toLowerCase())
      )
    } else {
      // Filter files
      if (!searchString) return workspaceFiles.slice(0, 100) // limit to 100 items for performance
      return workspaceFiles
        .filter((file) =>
          file.name.toLowerCase().includes(searchString.toLowerCase()) ||
          file.path.toLowerCase().includes(searchString.toLowerCase())
        )
        .slice(0, 100)
    }
  }, [isCommandMode, searchString, workspaceFiles])

  // Reset selection index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll active item into view
  useEffect(() => {
    const listEl = listRef.current
    if (!listEl) return

    const activeEl = listEl.querySelector('.command-palette-item.active') as HTMLElement
    if (activeEl) {
      const containerHeight = listEl.clientHeight
      const activeTop = activeEl.offsetTop
      const activeHeight = activeEl.offsetHeight

      if (activeTop + activeHeight > listEl.scrollTop + containerHeight) {
        listEl.scrollTop = activeTop + activeHeight - containerHeight
      } else if (activeTop < listEl.scrollTop) {
        listEl.scrollTop = activeTop
      }
    }
  }, [selectedIndex])

  // Keybindings listener inside modal
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) =>
          filteredItems.length > 0 ? (prev - 1 + filteredItems.length) % filteredItems.length : 0
        )
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems.length > 0) {
          handleConfirm(filteredItems[selectedIndex])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredItems, selectedIndex, onClose])

  const handleConfirm = (item: CommandOption | WorkspaceFile) => {
    if ('action' in item) {
      // Execute command action
      onExecuteCommand(item.action)
    } else {
      // Open file
      onOpenFile(item.path)
    }
    onClose()
  }

  // Get display path relative to workspace
  const getRelativePath = (absolutePath: string) => {
    if (!workspacePath) return absolutePath
    if (absolutePath.startsWith(workspacePath)) {
      return absolutePath.slice(workspacePath.length).replace(/^[/\\]/, '')
    }
    return absolutePath
  }

  if (!isOpen) return null

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-search">
          <SearchIcon className="command-palette-search-icon" size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isCommandMode
                ? 'Escribe un comando para ejecutar...'
                : 'Escribe para buscar archivos (ej: > para comandos)...'
            }
            className="command-palette-input"
          />
        </div>

        <div ref={listRef} className="command-palette-list">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => {
              const isActive = index === selectedIndex

              if ('action' in item) {
                // Render command option
                return (
                  <div
                    key={item.id}
                    className={`command-palette-item command-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleConfirm(item)}
                  >
                    <span className="command-palette-command-prefix">&gt;</span>
                    <span className="command-palette-item-name">{item.name}</span>
                    {item.shortcut && (
                      <kbd className="command-palette-shortcut">{item.shortcut}</kbd>
                    )}
                  </div>
                )
              } else {
                // Render file option
                return (
                  <div
                    key={item.path}
                    className={`command-palette-item file-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleConfirm(item)}
                  >
                    <FileIcon className="command-palette-file-icon" size={14} />
                    <div className="command-palette-file-info">
                      <span className="command-palette-item-name">{item.name}</span>
                      <span className="command-palette-file-path" title={item.path}>
                        {getRelativePath(item.path)}
                      </span>
                    </div>
                  </div>
                )
              }
            })
          ) : (
            <div className="command-palette-empty">No hay resultados que coincidan.</div>
          )}
        </div>
      </div>
    </div>
  )
}

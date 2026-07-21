import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownEditor } from './components/MarkdownEditor'
import { MarkdownPreview } from './components/MarkdownPreview'
import { FileExplorer } from './components/FileExplorer'
import { TabBar, type Tab } from './components/TabBar'
import { DropOverlay, Toolbar, type ViewMode } from './components/Toolbar'
import { EmptyIcon } from './components/Icons'
import { CommandPalette } from './components/CommandPalette'
import { getElectronAPI, hasElectronAPI } from './lib/electron'
import { isMarkdownFile } from './lib/images'
import { prepareExportHtml } from './lib/pdf'
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from './lib/theme'
import { getAppConfig, saveAppConfig, type AppConfig } from './lib/config'
import { SettingsModal } from './components/SettingsModal'
import './App.css'

const WELCOME = `# Bienvenido a MarkDown EV

Un visor-editor de Markdown minimalista para macOS.

## Características

- **Abrir cualquier archivo** — sin vault, arrastra un \`.md\` a la ventana
- **Vista dividida** — editor y preview en tiempo real
- **LaTeX** — inline $E = mc^2$ y en bloque:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

- **Imágenes locales** — \`![alt](./imagen.png)\` relativo al archivo abierto
- **Exportar PDF** — botón PDF o ⌘P
- **Temas** — oscuro / claro con el botón ☀️/🌙

## Atajos

| Acción | Atajo |
|--------|-------|
| Abrir | ⌘O |
| Guardar | ⌘S |
| Exportar PDF | ⌘P |
| Solo editor | ⌘1 |
| Dividido | ⌘2 |
| Solo preview | ⌘3 |
| Negrita | ⌘B |
| Itálica | ⌘I |
| Enlace | ⌘K |
| Bloque de código | ⌘⇧C |
`

const RECENT_FILES_KEY = 'markdown-ev-recent-files'
const menuToViewMode: Record<string, ViewMode> = {
  'menu:view-edit': 'edit',
  'menu:view-split': 'split',
  'menu:view-preview': 'preview',
}

function App() {
  // Tabs and active tab
  const [tabs, setTabs] = useState<Tab[]>(() => {
    return [
      {
        id: 'welcome',
        filePath: null,
        content: WELCOME,
        savedContent: WELCOME,
      },
    ]
  })
  const [activeTabId, setActiveTabId] = useState<string | null>('welcome')

  // General App State
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [isDragging, setIsDragging] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [currentDir, setCurrentDir] = useState<{ path: string; name: string } | null>(null)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandPaletteMode, setCommandPaletteMode] = useState<'file' | 'command'>('file')
  const [config, setConfig] = useState<AppConfig>(() => getAppConfig())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const zoomLevelRef = useRef(0)
  const dragCounterRef = useRef(0)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current))
    }, 3500)
  }, [])

  // Recent files state
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_FILES_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  // Scroll sync refs
  const editorHandleRef = useRef<{ scrollToLine: (line: number) => void } | null>(null)
  const previewHandleRef = useRef<{ scrollToLine: (line: number) => void } | null>(null)
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null)
  const scrollGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  // Active Tab Derived State
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const content = activeTab ? activeTab.content : ''
  const filePath = activeTab ? activeTab.filePath : null
  const savedContent = activeTab ? activeTab.savedContent : ''
  const isDirty = activeTab ? content !== savedContent : false

  useEffect(() => {
    applyTheme(theme)
    setStoredTheme(theme)
  }, [theme])

  // Save recent files to localStorage
  const saveRecentFiles = useCallback((paths: string[]) => {
    setRecentFiles(paths)
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(paths))
  }, [])

  // Add path to recent files
  const addToRecentFiles = useCallback(
    (path: string) => {
      const filtered = recentFiles.filter((p) => p !== path)
      const updated = [path, ...filtered].slice(0, 15) // Limit to 15 files
      saveRecentFiles(updated)
    },
    [recentFiles, saveRecentFiles],
  )

  // Remove single file from recent list
  const handleRemoveRecentFile = useCallback(
    (path: string) => {
      const updated = recentFiles.filter((p) => p !== path)
      saveRecentFiles(updated)
    },
    [recentFiles, saveRecentFiles],
  )

  // Clear recent files list
  const handleClearRecentFiles = useCallback(() => {
    saveRecentFiles([])
  }, [saveRecentFiles])

  // Update content of active tab
  const setContent = useCallback(
    (newContent: string) => {
      if (!activeTabId) return
      setTabs((prevTabs) =>
        prevTabs.map((t) => (t.id === activeTabId ? { ...t, content: newContent } : t)),
      )
    },
    [activeTabId],
  )

  // Create new blank file tab
  const handleNewFile = useCallback(() => {
    const newId = `unsaved-${Date.now()}`
    const newTab: Tab = {
      id: newId,
      filePath: null,
      content: '',
      savedContent: '',
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newId)
  }, [])

  // Open file in tabs (or focus if already open)
  const openFileInTab = useCallback(
    (path: string, fileContent: string) => {
      // Check if file is already open
      const existingTab = tabs.find((t) => t.filePath === path)
      if (existingTab) {
        setActiveTabId(existingTab.id)
        return
      }

      // Add new tab
      const newTab: Tab = {
        id: path,
        filePath: path,
        content: fileContent,
        savedContent: fileContent,
      }

      // If we only have the pristine welcome tab open, replace it
      if (
        tabs.length === 1 &&
        tabs[0].id === 'welcome' &&
        tabs[0].content === WELCOME &&
        tabs[0].content === tabs[0].savedContent
      ) {
        setTabs([newTab])
      } else {
        setTabs((prev) => [...prev, newTab])
      }

      setActiveTabId(path)
      addToRecentFiles(path)
    },
    [tabs, addToRecentFiles],
  )

  const openFilePath = useCallback(
    async (path: string) => {
      if (!hasElectronAPI()) return
      try {
        const result = await getElectronAPI().readFile(path)
        if (result) {
          openFileInTab(result.filePath, result.content)
        }
      } catch (err) {
        console.error('Error al abrir el archivo:', err)
      }
    },
    [openFileInTab],
  )

  const handleOpen = useCallback(async () => {
    if (!hasElectronAPI()) return
    const result = await getElectronAPI().openFile()
    if (!result) return
    openFileInTab(result.filePath, result.content)
  }, [openFileInTab])

  const handleSave = useCallback(async () => {
    if (!activeTabId || !hasElectronAPI()) return
    const result = await getElectronAPI().saveFile(content, filePath ?? undefined)
    if (!result) return

    // Update tab info
    setTabs((prevTabs) =>
      prevTabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              id: result.filePath,
              filePath: result.filePath,
              savedContent: content,
            }
          : t,
      ),
    )
    setActiveTabId(result.filePath)
    addToRecentFiles(result.filePath)
  }, [activeTabId, content, filePath, addToRecentFiles])

  const handleSaveAs = useCallback(async () => {
    if (!activeTabId || !hasElectronAPI()) return
    const result = await getElectronAPI().saveFileAs(content, filePath ?? undefined)
    if (!result) return

    // Update tab info
    setTabs((prevTabs) =>
      prevTabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              id: result.filePath,
              filePath: result.filePath,
              savedContent: content,
            }
          : t,
      ),
    )
    setActiveTabId(result.filePath)
    addToRecentFiles(result.filePath)
  }, [activeTabId, content, filePath, addToRecentFiles])

  // Close tab handler
  const handleTabClose = useCallback(
    (tabId: string) => {
      const targetTab = tabs.find((t) => t.id === tabId)
      if (!targetTab) return

      const isTabDirty = targetTab.content !== targetTab.savedContent
      if (isTabDirty) {
        const confirmClose = window.confirm(
          `El archivo "${
            targetTab.filePath ? targetTab.filePath.split(/[/\\]/).pop() : 'Sin título'
          }" tiene cambios sin guardar. ¿Deseas cerrarlo de todos modos?`,
        )
        if (!confirmClose) return
      }

      const filteredTabs = tabs.filter((t) => t.id !== tabId)
      setTabs(filteredTabs)

      if (activeTabId === tabId) {
        if (filteredTabs.length > 0) {
          // Select adjacent tab
          const index = tabs.findIndex((t) => t.id === tabId)
          const newActiveIndex = Math.max(0, index - 1)
          setActiveTabId(filteredTabs[newActiveIndex].id)
        } else {
          setActiveTabId(null)
        }
      }
    },
    [tabs, activeTabId],
  )

  // Reorder tabs via Drag & Drop
  const handleTabReorder = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const handleExportHtml = useCallback(async () => {
    if (!activeTab) return
    setStatusMessage('Generando HTML…')
    try {
      const html = await prepareExportHtml(content, filePath, (absolutePath) =>
        getElectronAPI().readAsDataUrl(absolutePath),
      )
      const suggestedName = filePath?.split(/[/\\]/).pop() ?? 'documento.md'
      if (hasElectronAPI()) {
        const result = await getElectronAPI().exportHtml(html, suggestedName)
        if (result) {
          showToast(`HTML exportado: ${result.filePath.split(/[/\\]/).pop()}`)
        }
      }
    } catch (err) {
      console.error('Error al exportar HTML:', err)
    } finally {
      setStatusMessage(null)
    }
  }, [activeTab, content, filePath, showToast])

  const handleCopyRichText = useCallback(async () => {
    if (!activeTab) return
    try {
      const html = await prepareExportHtml(content, filePath, (absolutePath) =>
        getElectronAPI().readAsDataUrl(absolutePath),
      )
      const blobHtml = new Blob([html], { type: 'text/html' })
      const blobText = new Blob([content], { type: 'text/plain' })
      const clipboardItem = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      })
      await navigator.clipboard.write([clipboardItem])
      showToast('Copiado al portapapeles con formato enriquecido ✨')
    } catch (err) {
      console.error('Error al copiar Rich Text:', err)
      await navigator.clipboard.writeText(content)
      showToast('Copiado texto plano al portapapeles')
    }
  }, [activeTab, content, filePath, showToast])

  const handleExportPdf = useCallback(async () => {
    if (!activeTab || !hasElectronAPI()) return

    setStatusMessage('Generando PDF…')

    try {
      const html = await prepareExportHtml(content, filePath, (absolutePath) =>
        getElectronAPI().readAsDataUrl(absolutePath),
      )

      const suggestedName = filePath?.split(/[/\\]/).pop() ?? 'documento.md'
      const result = await getElectronAPI().exportPdf(html, suggestedName)

      if (result) {
        setStatusMessage(`PDF guardado: ${result.filePath}`)
      } else {
        setStatusMessage(null)
      }
    } catch {
      setStatusMessage('Error al exportar PDF')
    }

    setTimeout(() => setStatusMessage(null), 4000)
  }, [activeTab, content, filePath])

  const handleThemeToggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  // ─── Auto-save ────────────────────────────────────────

  useEffect(() => {
    if (!config.autoSave || !filePath || content === savedContent) return

    const timer = setTimeout(() => {
      void handleSave()
    }, config.autoSaveDelay * 1000)

    return () => clearTimeout(timer)
  }, [content, filePath, savedContent, handleSave, config.autoSave, config.autoSaveDelay])

  // ─── Scroll sync ───────────────────────────────────────

  const setScrollGuard = useCallback((source: 'editor' | 'preview') => {
    scrollSourceRef.current = source
    if (scrollGuardTimerRef.current) {
      clearTimeout(scrollGuardTimerRef.current)
    }
    scrollGuardTimerRef.current = setTimeout(() => {
      scrollSourceRef.current = null
      scrollGuardTimerRef.current = null
    }, 80)
  }, [])

  const handleEditorScroll = useCallback(
    (line: number) => {
      if (scrollSourceRef.current === 'preview') return
      setScrollGuard('editor')
      previewHandleRef.current?.scrollToLine(line)
    },
    [setScrollGuard],
  )

  const handlePreviewScroll = useCallback(
    (line: number) => {
      if (scrollSourceRef.current === 'editor') return
      setScrollGuard('preview')
      editorHandleRef.current?.scrollToLine(line)
    },
    [setScrollGuard],
  )

  // ─── Workspace Resizing ────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startRatio = splitRatio

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const workspaceWidth = document.querySelector('.workspace')?.clientWidth || 1
      const deltaRatio = (deltaX / workspaceWidth) * 100
      const newRatio = Math.min(Math.max(startRatio + deltaRatio, 15), 85)
      setSplitRatio(newRatio)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [splitRatio])

  // ─── Clipboard Image pasting ───────────────────────────

  const handlePasteImage = useCallback((file: File, insertCallback: (relativePath: string) => void) => {
    if (!filePath) {
      setStatusMessage('Guarda el archivo para pegar imágenes del portapapeles')
      setTimeout(() => setStatusMessage(null), 3000)
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64Data = (reader.result as string).split(',')[1]
        const ext = file.type.split('/')[1] || 'png'
        const imageName = `pasted_image_${Date.now()}.${ext}`

        const result = await getElectronAPI().saveClipboardImage(filePath, base64Data, imageName)
        if ('error' in result) {
          setStatusMessage(result.error)
          setTimeout(() => setStatusMessage(null), 3000)
        } else {
          insertCallback(result.relativePath)
          setStatusMessage('Imagen del portapapeles guardada')
          setTimeout(() => setStatusMessage(null), 3000)
        }
      } catch {
        setStatusMessage('Error al guardar la imagen')
        setTimeout(() => setStatusMessage(null), 3000)
      }
    }
    reader.readAsDataURL(file)
  }, [filePath])

  const handleHeadingClick = useCallback((line: number, id: string) => {
    // Scroll editor
    editorHandleRef.current?.scrollToLine(line)

    // Scroll preview pane
    const previewPane = document.querySelector('.pane--preview')
    const headingEl = document.getElementById(id)
    if (previewPane && headingEl) {
      const containerTop = previewPane.getBoundingClientRect().top
      const elementTop = headingEl.getBoundingClientRect().top
      previewPane.scrollTop += elementTop - containerTop
    }
  }, [])

  // ─── Explorer interaction ─────────────────────────────

  const handleOpenFileFromExplorer = useCallback(
    async (path: string) => {
      if (!hasElectronAPI()) return
      const result = await getElectronAPI().readFile(path)
      if (!result) return
      openFileInTab(result.filePath, result.content)
    },
    [openFileInTab],
  )

  const handleSearchMatchClick = useCallback(
    async (path: string, line: number) => {
      if (!hasElectronAPI()) return
      const result = await getElectronAPI().readFile(path)
      if (!result) return

      // Open tab
      openFileInTab(result.filePath, result.content)

      // Nav to line
      setTimeout(() => {
        editorHandleRef.current?.scrollToLine(line)

        const lineEl = document.querySelector(`[data-line="${line}"]`)
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    },
    [openFileInTab],
  )

  const handleWikiLinkClick = useCallback(
    async (noteName: string) => {
      if (!hasElectronAPI()) return
      const result = await getElectronAPI().resolveWikiLink(
        currentDir ? currentDir.path : null,
        filePath,
        noteName,
      )

      if ('error' in result) {
        setStatusMessage(result.error)
        setTimeout(() => setStatusMessage(null), 3000)
        return
      }

      const fileData = await getElectronAPI().readFile(result.filePath)
      if (!fileData) return

      openFileInTab(fileData.filePath, fileData.content)

      if (result.created) {
        setStatusMessage(`Creada nota: ${noteName}`)
        setTimeout(() => setStatusMessage(null), 3000)
      }
    },
    [currentDir, filePath, openFileInTab],
  )

  const handleExecuteCommand = useCallback(
    (action: string) => {
      switch (action) {
        case 'new-file':
          handleNewFile()
          break
        case 'open-folder':
          void (async () => {
            if (hasElectronAPI()) {
              const dir = await getElectronAPI().openDirectory()
              if (dir) {
                setCurrentDir(dir)
              }
            }
          })()
          break
        case 'save-file':
          void handleSave()
          break
        case 'save-as':
          void handleSaveAs()
          break
        case 'export-pdf':
          void handleExportPdf()
          break
        case 'theme-toggle':
          handleThemeToggle()
          break
        case 'view-edit':
          setViewMode('edit')
          break
        case 'view-split':
          setViewMode('split')
          break
        case 'view-preview':
          setViewMode('preview')
          break
        case 'close-tab':
          if (activeTabId) {
            handleTabClose(activeTabId)
          }
          break
        case 'open-settings':
          setIsSettingsOpen(true)
          break
        default:
          break
      }
    },
    [
      handleNewFile,
      handleSave,
      handleSaveAs,
      handleExportPdf,
      handleThemeToggle,
      activeTabId,
      handleTabClose,
    ],
  )

  const handleSaveConfig = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig)
    saveAppConfig(newConfig)
  }, [])

  // ─── Drag & Drop ──────────────────────────────────────

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    dragCounterRef.current += 1
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      dragCounterRef.current = 0
      setIsDragging(false)

      if (!hasElectronAPI()) return

      const file = event.dataTransfer.files[0]
      if (!file) return

      const path = getElectronAPI().getPathForFile(file)
      if (!isMarkdownFile(path)) {
        setStatusMessage('Solo se admiten archivos .md / .txt')
        setTimeout(() => setStatusMessage(null), 3000)
        return
      }

      const result = await getElectronAPI().readFile(path)
      if (!result) return
      openFileInTab(result.filePath, result.content)
    },
    [openFileInTab],
  )

  // ─── Menu actions ─────────────────────────────────────

  useEffect(() => {
    if (!hasElectronAPI()) return

    return getElectronAPI().onMenuAction((action) => {
      switch (action) {
        case 'menu:open':
          void handleOpen()
          break
        case 'menu:save':
          void handleSave()
          break
        case 'menu:save-as':
          void handleSaveAs()
          break
        case 'menu:export-pdf':
          void handleExportPdf()
          break
        case 'menu:theme-dark':
          setTheme('dark')
          break
        case 'menu:theme-light':
          setTheme('light')
          break
        default: {
          const mode = menuToViewMode[action]
          if (mode) setViewMode(mode)
        }
      }
    })
  }, [handleOpen, handleSave, handleSaveAs, handleExportPdf])

  // ─── Listen to files opened from Finder ───────────────

  useEffect(() => {
    if (!hasElectronAPI()) return

    // 1. Listen for new files opened while the app is running
    const unsubscribe = getElectronAPI().onOpenFile((filePath) => {
      void openFilePath(filePath)
    })

    // 2. Check if a file was clicked to launch the app
    getElectronAPI()
      .checkFileToOpen()
      .then((filePath) => {
        if (filePath) {
          void openFilePath(filePath)
        }
      })
      .catch((err) => console.error('Error al revisar archivo de inicio:', err))

    return unsubscribe
  }, [openFilePath])

  // ─── Unsaved-changes close guard ────────────────────────

  useEffect(() => {
    if (!hasElectronAPI()) return
    const api = getElectronAPI()

    const unsubClose = api.onBeforeClose(() => {
      const hasDirty = tabsRef.current.some((t) => t.content !== t.savedContent)
      api.reportDirtyState(hasDirty)
    })

    const unsubSave = api.onSaveAllThenClose(async () => {
      for (const tab of tabsRef.current) {
        if (tab.content !== tab.savedContent && tab.filePath) {
          await api.saveFile(tab.content, tab.filePath)
        }
      }
      api.reportAllSaved()
    })

    return () => {
      unsubClose()
      unsubSave()
    }
  }, [])

  // ─── Keyboard shortcuts ───────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return

      if (event.key === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          void handleSaveAs()
        } else {
          void handleSave()
        }
      } else if (event.key === 'o') {
        event.preventDefault()
        void handleOpen()
      } else if (event.key === 'p') {
        event.preventDefault()
        if (event.altKey) {
          void handleExportPdf()
        } else if (event.shiftKey) {
          setCommandPaletteMode('command')
          setIsCommandPaletteOpen(true)
        } else {
          setCommandPaletteMode('file')
          setIsCommandPaletteOpen(true)
        }
      } else if (event.key === 't' || (event.key === 'n' && !event.shiftKey)) {
        event.preventDefault()
        handleNewFile()
      } else if (event.key === 'w') {
        event.preventDefault()
        if (activeTabId) {
          handleTabClose(activeTabId)
        }
      } else if (event.key === '1') {
        setViewMode('edit')
      } else if (event.key === '2') {
        setViewMode('split')
      } else if (event.key === '3') {
        setViewMode('preview')
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        const next = Math.min(zoomLevelRef.current + 0.2, 2.0)
        zoomLevelRef.current = next
        if (hasElectronAPI()) {
          getElectronAPI().setZoomLevel(next)
        }
      } else if (event.key === '-') {
        event.preventDefault()
        const next = Math.max(zoomLevelRef.current - 0.2, -1.0)
        zoomLevelRef.current = next
        if (hasElectronAPI()) {
          getElectronAPI().setZoomLevel(next)
        }
      } else if (event.key === '0') {
        event.preventDefault()
        zoomLevelRef.current = 0
        if (hasElectronAPI()) {
          getElectronAPI().setZoomLevel(0)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpen, handleSave, handleSaveAs, handleExportPdf, handleNewFile, handleTabClose, activeTabId])

  // ─── Unsaved changes guard ────────────────────────────

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const anyDirty = tabs.some((t) => t.content !== t.savedContent)
      if (anyDirty) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [tabs])

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

  return (
    <div
      className={`app ${isMac ? 'is-mac' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      <Toolbar
          fileName={filePath}
          isDirty={isDirty}
          viewMode={viewMode}
          theme={theme}
          focusMode={focusMode}
          onOpen={handleOpen}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onExportPdf={handleExportPdf}
          onExportHtml={handleExportHtml}
          onCopyRichText={handleCopyRichText}
          onThemeToggle={handleThemeToggle}
          onFocusModeToggle={() => setFocusMode((prev) => !prev)}
          onViewModeChange={setViewMode}
          onSettingsOpen={() => setIsSettingsOpen(true)}
        />

        <div className="main-content">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
          />

          {filePath && (
            <div className="breadcrumbs-bar">
              {filePath.split(/[/\\]/).map((segment, idx, arr) => (
                <span key={idx} className="breadcrumb-segment">
                  <span className={`breadcrumb-item ${idx === arr.length - 1 ? 'active' : ''}`}>
                    {segment}
                  </span>
                  {idx < arr.length - 1 && <span className="breadcrumb-separator">›</span>}
                </span>
              ))}
            </div>
          )}

        <FileExplorer
          currentDir={currentDir}
          onCurrentDirChange={setCurrentDir}
          activeFilePath={filePath}
          activeFileContent={activeTab ? content : null}
          onOpenFile={handleOpenFileFromExplorer}
          recentFiles={recentFiles}
          onRemoveRecentFile={handleRemoveRecentFile}
          onClearRecentFiles={handleClearRecentFiles}
          onHeadingClick={handleHeadingClick}
          onSearchMatchClick={handleSearchMatchClick}
        />

        <div className="main-content">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
            onTabClose={handleTabClose}
          />

          {activeTab ? (
            <main
              className={`workspace workspace--${viewMode}`}
              style={
                viewMode === 'split'
                  ? { gridTemplateColumns: `${splitRatio}% 1px ${100 - splitRatio}%` }
                  : undefined
              }
            >
              {(viewMode === 'edit' || viewMode === 'split') && (
                <section className="pane pane--editor">
                  <MarkdownEditor
                    value={content}
                    onChange={setContent}
                    theme={theme}
                    fontSize={config.fontSize}
                    fontFamily={config.fontFamily}
                    lineHeight={config.lineHeight}
                    tabSize={config.tabSize}
                    vimMode={config.vimMode}
                    focusMode={focusMode}
                    onScroll={viewMode === 'split' ? handleEditorScroll : undefined}
                    editorRef={viewMode === 'split' ? editorHandleRef : undefined}
                    onPasteImage={handlePasteImage}
                  />
                </section>
              )}

              {viewMode === 'split' && (
                <div
                  className="workspace-resizer"
                  onMouseDown={handleResizeStart}
                />
              )}

              {(viewMode === 'preview' || viewMode === 'split') && (
                <section className="pane pane--preview">
                  <MarkdownPreview
                    content={content}
                    filePath={filePath}
                    theme={theme}
                    onScroll={viewMode === 'split' ? handlePreviewScroll : undefined}
                    previewRef={viewMode === 'split' ? previewHandleRef : undefined}
                    onWikiLinkClick={handleWikiLinkClick}
                  />
                </section>
              )}
            </main>
          ) : (
            <div className="workspace-empty">
              <div className="workspace-empty-content">
                <EmptyIcon className="workspace-empty-icon" size={48} />
                <p>No hay ningún archivo abierto</p>
                <button
                  type="button"
                  className="workspace-empty-btn"
                  onClick={handleNewFile}
                >
                  Nuevo Documento
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span>{statusMessage ?? filePath ?? (activeTab ? 'Documento sin guardar' : 'Listo')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {activeTab && (
            <span className="statusbar-counts">
              {content.length} caracteres | {content.trim() === '' ? 0 : content.trim().split(/\s+/).length} palabras
            </span>
          )}
          <span>{activeTab ? (isDirty ? 'Modificado' : 'Guardado') : ''}</span>
        </div>
      </footer>

      <DropOverlay visible={isDragging} />
      {toastMessage && (
        <div className="toast-notification">
          <span>{toastMessage}</span>
        </div>
      )}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        mode={commandPaletteMode}
        workspacePath={currentDir ? currentDir.path : null}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenFile={handleOpenFileFromExplorer}
        onExecuteCommand={handleExecuteCommand}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        config={config}
        onClose={() => setIsSettingsOpen(false)}
        onSaveConfig={handleSaveConfig}
      />
    </div>
  )
}

export default App

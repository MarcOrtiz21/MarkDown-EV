import { useCallback, useEffect, useState } from 'react'
import { getElectronAPI, hasElectronAPI } from '../lib/electron'
import type { FileSearchResult } from '../types/electron'
import {
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  PlusIcon,
  CloseIcon,
  ListIcon,
  FolderExplorerIcon,
  SearchIcon,
} from './Icons'

type FileExplorerProps = {
  activeFilePath: string | null
  activeFileContent: string | null
  onOpenFile: (filePath: string) => void
  recentFiles: string[]
  onRemoveRecentFile: (filePath: string) => void
  onClearRecentFiles: () => void
  onHeadingClick: (line: number, id: string) => void
  onSearchMatchClick: (filePath: string, line: number) => void
}

type FileNode = {
  name: string
  path: string
  isDirectory: boolean
}

type HeadingItem = {
  text: string
  level: number
  id: string
  line: number
}

// Helper to parse headings and their line numbers from markdown
function parseHeadings(markdownText: string | null): HeadingItem[] {
  if (!markdownText) return []
  const lines = markdownText.split('\n')
  const headings: HeadingItem[] = []
  
  let inCodeBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
      headings.push({ text, level, id, line: i })
    }
  }
  return headings
}

// Highlight query matches helper
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  
  if (index === -1) return <>{text}</>
  
  const before = text.substring(0, index)
  const match = text.substring(index, index + query.length)
  const after = text.substring(index + query.length)
  
  return (
    <>
      {before}
      <mark className="search-highlight">{match}</mark>
      {after}
    </>
  )
}

export function FileExplorer({
  activeFilePath,
  activeFileContent,
  onOpenFile,
  recentFiles,
  onRemoveRecentFile,
  onClearRecentFiles,
  onHeadingClick,
  onSearchMatchClick,
}: FileExplorerProps) {
  // Sidebar tabs: 'files' | 'outline' | 'search'
  const [activeTab, setActiveTab] = useState<'files' | 'outline' | 'search'>('files')

  // Directory explorer state
  const [currentDir, setCurrentDir] = useState<{ path: string; name: string } | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [dirContents, setDirContents] = useState<Record<string, FileNode[]>>({})
  const [creatingInPath, setCreatingInPath] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Global search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

  // Parse headings from the current document
  const headings = parseHeadings(activeFileContent)

  // Load folder contents
  const loadDirectory = useCallback(async (dirPath: string) => {
    if (!hasElectronAPI()) return
    const contents = await getElectronAPI().readDirectory(dirPath)
    setDirContents((prev) => ({
      ...prev,
      [dirPath]: contents,
    }))
  }, [])

  // Open folder picker
  const handleOpenFolder = async () => {
    if (!hasElectronAPI()) return
    const dir = await getElectronAPI().openDirectory()
    if (dir) {
      setCurrentDir(dir)
      setExpandedPaths(new Set([dir.path]))
      await loadDirectory(dir.path)
      await getElectronAPI().watchDirectory(dir.path)
    }
  }

  // Close active folder
  const handleCloseFolder = async () => {
    if (hasElectronAPI()) {
      await getElectronAPI().unwatchDirectory()
    }
    setCurrentDir(null)
    setExpandedPaths(new Set())
    setDirContents({})
    setCreatingInPath(null)
    setSearchQuery('')
    setSearchResults([])
    setActiveTab('files')
  }

  // Toggle folder expansion
  const handleToggleFolder = async (dirPath: string) => {
    const newExpanded = new Set(expandedPaths)
    if (newExpanded.has(dirPath)) {
      newExpanded.delete(dirPath)
    } else {
      newExpanded.add(dirPath)
      await loadDirectory(dirPath)
    }
    setExpandedPaths(newExpanded)
  }

  // File system watcher listener
  useEffect(() => {
    if (!hasElectronAPI() || !currentDir) return

    const unsubscribe = getElectronAPI().onDirectoryChanged(() => {
      // Refresh all expanded directories
      for (const path of expandedPaths) {
        void loadDirectory(path)
      }
      if (currentDir) {
        void loadDirectory(currentDir.path)
      }
    })

    return unsubscribe
  }, [currentDir, expandedPaths, loadDirectory])

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim() || !currentDir) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    const timer = setTimeout(async () => {
      if (hasElectronAPI()) {
        const results = await getElectronAPI().searchInDirectory(currentDir.path, searchQuery.trim())
        setSearchResults(results)
      }
      setIsSearching(false)
    }, 300) // 300ms debounce

    return () => clearTimeout(timer)
  }, [searchQuery, currentDir])

  // Handle new file creation
  const handleCreateFileSubmit = async (e: React.FormEvent, parentPath: string) => {
    e.preventDefault()
    if (!newFileName.trim()) return

    if (!hasElectronAPI()) return

    const result = await getElectronAPI().createNewFile(parentPath, newFileName.trim())

    if ('error' in result) {
      setErrorMsg(result.error)
      setTimeout(() => setErrorMsg(null), 3000)
    } else {
      setNewFileName('')
      setCreatingInPath(null)
      onOpenFile(result.filePath)
      void loadDirectory(parentPath)
    }
  }

  // Toggle collapsed search file node
  const toggleFileCollapse = (path: string) => {
    const newCollapsed = new Set(collapsedFiles)
    if (newCollapsed.has(path)) {
      newCollapsed.delete(path)
    } else {
      newCollapsed.add(path)
    }
    setCollapsedFiles(newCollapsed)
  }

  // Render the file tree recursively
  const renderNode = (node: FileNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path)
    const isActive = activeFilePath === node.path
    const isEditing = creatingInPath === node.path

    if (node.isDirectory) {
      const children = dirContents[node.path] ?? []

      return (
        <div key={node.path} className="file-tree-node-wrapper">
          <div
            className={`file-tree-node file-tree-node--directory depth-${depth}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <button
              type="button"
              className="file-tree-arrow-btn"
              onClick={() => handleToggleFolder(node.path)}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
            <span
              className="file-tree-label"
              onClick={() => handleToggleFolder(node.path)}
            >
              {isExpanded ? (
                <FolderOpenIcon className="node-icon directory-icon" size={14} />
              ) : (
                <FolderIcon className="node-icon directory-icon" size={14} />
              )}
              {node.name}
            </span>
            <button
              type="button"
              className="file-tree-action-btn"
              title="Nuevo archivo"
              onClick={() => {
                setCreatingInPath(node.path)
                setNewFileName('')
                if (!isExpanded) {
                  void handleToggleFolder(node.path)
                }
              }}
            >
              <PlusIcon size={12} />
            </button>
          </div>

          {isExpanded && (
            <div className="file-tree-children">
              {isEditing && (
                <form
                  onSubmit={(e) => handleCreateFileSubmit(e, node.path)}
                  className="file-tree-new-file-form"
                  style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
                >
                  <FileIcon className="node-icon file-icon" size={14} />
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="nuevo-archivo.md"
                    autoFocus
                    onBlur={() => setCreatingInPath(null)}
                  />
                </form>
              )}

              {children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    } else {
      const isMd = /\.md$/i.test(node.name)
      if (!isMd && !/\.txt$/i.test(node.name)) return null

      return (
        <div
          key={node.path}
          className={`file-tree-node file-tree-node--file depth-${depth} ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
          onClick={() => onOpenFile(node.path)}
        >
          <span className="file-tree-label">
            <FileIcon className="node-icon file-icon" size={14} />
            {node.name}
          </span>
        </div>
      )
    }
  }

  return (
    <aside className="sidebar-explorer">
      {/* Sidebar Tabs Explorer vs Outline vs Search */}
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title="Explorador de archivos"
        >
          <FolderExplorerIcon size={14} />
          <span>Archivos</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'outline' ? 'active' : ''}`}
          onClick={() => setActiveTab('outline')}
          title="Esquema / Índice"
          disabled={!activeFileContent}
        >
          <ListIcon size={14} />
          <span>Esquema</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
          title="Buscar en la carpeta"
          disabled={!currentDir}
        >
          <SearchIcon size={14} />
          <span>Buscar</span>
        </button>
      </div>

      <div className="sidebar-scrollable">
        {errorMsg && <div className="sidebar-error-banner">{errorMsg}</div>}

        {activeTab === 'files' && (
          /* File Explorer Mode */
          <>
            {currentDir ? (
              <div className="file-tree">
                <div className="file-tree-root-header">
                  <FolderOpenIcon className="root-folder-icon" size={15} />
                  <span className="root-folder-name" title={currentDir.path}>
                    {currentDir.name}
                  </span>
                  <button
                    type="button"
                    className="file-tree-action-btn"
                    title="Nuevo archivo en raíz"
                    onClick={() => {
                      setCreatingInPath(currentDir.path)
                      setNewFileName('')
                    }}
                  >
                    <PlusIcon size={12} />
                  </button>
                  <button
                    type="button"
                    className="file-tree-action-btn"
                    title="Cerrar carpeta"
                    onClick={handleCloseFolder}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>

                <div className="file-tree-nodes">
                  {creatingInPath === currentDir.path && (
                    <form
                      onSubmit={(e) => handleCreateFileSubmit(e, currentDir.path)}
                      className="file-tree-new-file-form"
                      style={{ paddingLeft: '20px' }}
                    >
                      <FileIcon className="node-icon file-icon" size={14} />
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        placeholder="nuevo-archivo.md"
                        autoFocus
                        onBlur={() => setCreatingInPath(null)}
                      />
                    </form>
                  )}

                  {dirContents[currentDir.path]?.map((node) => renderNode(node, 0))}
                </div>
              </div>
            ) : (
              <div className="sidebar-empty-state">
                <button
                  type="button"
                  className="open-folder-btn"
                  onClick={handleOpenFolder}
                >
                  Abrir Carpeta
                </button>
                <p className="sidebar-tip">
                  Abre una carpeta del disco para navegar por tus archivos Markdown.
                </p>
              </div>
            )}

            {/* Recent files section */}
            {recentFiles.length > 0 && (
              <div className="recent-files-section">
                <div className="recent-files-header">
                  <span>Recientes</span>
                  <button
                    type="button"
                    className="clear-recent-btn"
                    onClick={onClearRecentFiles}
                  >
                    Limpiar
                  </button>
                </div>
                <ul className="recent-files-list">
                  {recentFiles.map((path) => {
                    const name = path.split(/[/\\]/).pop() || path
                    return (
                      <li
                        key={path}
                        className={`recent-file-item ${activeFilePath === path ? 'active' : ''}`}
                      >
                        <span
                          className="recent-file-link"
                          onClick={() => onOpenFile(path)}
                          title={path}
                        >
                          <FileIcon className="node-icon file-icon" size={13} style={{ marginRight: '6px' }} />
                          {name}
                        </span>
                        <button
                          type="button"
                          className="remove-recent-btn"
                          onClick={() => onRemoveRecentFile(path)}
                        >
                          <CloseIcon size={10} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        )}

        {activeTab === 'outline' && (
          /* Outline / TOC Mode */
          <div className="sidebar-outline">
            {headings.length > 0 ? (
              <div className="outline-list">
                {headings.map((heading, idx) => (
                  <div
                    key={`${heading.id}-${idx}`}
                    className={`outline-item level-${heading.level}`}
                    style={{ paddingLeft: `${(heading.level - 1) * 12 + 12}px` }}
                    onClick={() => onHeadingClick(heading.line, heading.id)}
                  >
                    <span className="outline-bullet">└</span>
                    <span className="outline-text" title={heading.text}>
                      {heading.text}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sidebar-empty-state">
                <p className="sidebar-tip">
                  El documento actual no contiene encabezados (# H1, ## H2...) para mostrar en el esquema.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && currentDir && (
          /* Global Search Mode */
          <div className="sidebar-search">
            <div className="sidebar-search-container">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar en archivos..."
                className="sidebar-search-input"
                autoFocus
              />
              {isSearching && <span className="sidebar-search-spinner" />}
            </div>

            <div className="search-results-list">
              {searchQuery.trim() !== '' ? (
                searchResults.length > 0 ? (
                  searchResults.map((result) => {
                    const isCollapsed = collapsedFiles.has(result.filePath)
                    return (
                      <div key={result.filePath} className="search-file-group">
                        <div
                          className="search-file-header"
                          onClick={() => toggleFileCollapse(result.filePath)}
                        >
                          <span className="search-file-arrow">{isCollapsed ? '▶' : '▼'}</span>
                          <FileIcon className="search-file-icon" size={13} />
                          <span className="search-file-name" title={result.filePath}>
                            {result.fileName}
                          </span>
                          <span className="search-match-count">{result.matches.length}</span>
                        </div>

                        {!isCollapsed && (
                          <div className="search-file-matches">
                            {result.matches.map((match, idx) => (
                              <div
                                key={`${match.lineNumber}-${idx}`}
                                className="search-match-item"
                                onClick={() => onSearchMatchClick(result.filePath, match.lineNumber - 1)}
                              >
                                <span className="search-match-line-num">{match.lineNumber}</span>
                                <span className="search-match-text">
                                  <HighlightMatch text={match.lineText} query={searchQuery} />
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  !isSearching && (
                    <div className="sidebar-empty-state">
                      <p className="sidebar-tip">No se encontraron coincidencias.</p>
                    </div>
                  )
                )
              ) : (
                <div className="sidebar-empty-state">
                  <p className="sidebar-tip">
                    Escribe una palabra o frase para buscar coincidencias en todos los documentos de la carpeta abierta.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

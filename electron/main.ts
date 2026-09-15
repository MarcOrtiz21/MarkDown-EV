import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import fs from 'node:fs/promises'
import { watch, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'


// ─── Single instance lock ────────────────────────────────
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let fileToOpen: string | null = null
let rendererReady = false
let isForceClosing = false
let isQuitRequested = false
let closeTimeout: ReturnType<typeof setTimeout> | null = null
const allowedRoots = new Set<string>()
const allowedRootsPath = () => path.join(app.getPath('userData'), 'allowed-roots.json')
const MARKDOWN_FILE_REGEX = /\.(?:md|markdown|mdown|mkd|txt)$/i
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt']

// Finder may launch the app with the document path as an initial argument.
// Queue it before the renderer is ready so React can consume it through the
// existing app:ready-to-open handshake.
const initialFilePath = process.argv
  .slice(1)
  .find((argument) => path.isAbsolute(argument) && MARKDOWN_FILE_REGEX.test(argument))
if (initialFilePath) {
  fileToOpen = normalizePath(initialFilePath)
  allowRoot(path.dirname(fileToOpen))
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath)
}

/**
 * Read text documents without turning UTF-16 Markdown files into gibberish.
 * A surprising number of files created by Windows editors include a BOM.
 */
async function readTextFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const littleEndianBuffer = Buffer.from(buffer.subarray(2))
    for (let index = 0; index + 1 < littleEndianBuffer.length; index += 2) {
      const first = littleEndianBuffer[index]
      littleEndianBuffer[index] = littleEndianBuffer[index + 1]
      littleEndianBuffer[index + 1] = first
    }
    return new TextDecoder('utf-16le').decode(littleEndianBuffer)
  }

  const content = buffer.toString('utf-8')
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

function persistAllowedRoots() {
  try {
    writeFileSync(allowedRootsPath(), JSON.stringify([...allowedRoots], null, 2), 'utf-8')
  } catch (err) {
    console.error('Error saving allowed file roots:', err)
  }
}

function loadAllowedRoots() {
  try {
    const stored = JSON.parse(readFileSync(allowedRootsPath(), 'utf-8'))
    if (Array.isArray(stored)) {
      for (const root of stored) {
        if (typeof root === 'string' && path.isAbsolute(root)) {
          allowedRoots.add(normalizePath(root))
        }
      }
    }
  } catch {
    // No persisted roots yet, or an older/corrupt preferences file.
  }
}

function allowRoot(rootPath: string) {
  const normalized = normalizePath(rootPath)
  if (allowedRoots.has(normalized)) return
  allowedRoots.add(normalized)
  if (app.isReady()) persistAllowedRoots()
}

function isAllowedPath(targetPath: string): boolean {
  const resolved = normalizePath(targetPath)
  for (const root of allowedRoots) {
    const relative = path.relative(root, resolved)
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return true
    }
  }
  return false
}

function isSafeFileName(fileName: string): boolean {
  return Boolean(fileName) &&
    fileName !== '.' &&
    fileName !== '..' &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !fileName.includes('\0')
}

function openFileFromMain(filePath: string) {
  allowRoot(path.dirname(filePath))
  fileToOpen = filePath
  if (mainWindow && mainWindow.webContents && rendererReady) {
    mainWindow.webContents.send('file:open-from-main', filePath)
  }
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  const filePath = commandLine
    .slice(1)
    .find((argument) => MARKDOWN_FILE_REGEX.test(argument))
  if (filePath) openFileFromMain(filePath)
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openFileFromMain(filePath)
})

// ─── Window state persistence ────────────────────────────
const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): { x?: number; y?: number; width: number; height: number; isMaximized?: boolean } {
  try {
    return JSON.parse(readFileSync(windowStatePath(), 'utf-8'))
  } catch {
    return { width: 1280, height: 860 }
  }
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    const isMaximized = mainWindow.isMaximized()
    writeFileSync(windowStatePath(), JSON.stringify({ ...bounds, isMaximized }))
  } catch { /* ignore */ }
}

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-image',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function createWindow() {
  const saved = loadWindowState()

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the preload bridge compatible with packaged Electron builds.
      // The renderer remains isolated through contextIsolation and nodeIntegration=false.
      sandbox: false,
    },
  })

  if (saved.isMaximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true
  })

  // Throttled window-geometry save
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveWindowState, 300) }
  mainWindow.on('resize', debouncedSave)
  mainWindow.on('move', debouncedSave)

  // Unsaved-changes guard
  mainWindow.on('close', (event) => {
    saveWindowState()
    if (!isForceClosing) {
      event.preventDefault()
      // Safety timeout: if renderer doesn't respond within 3s, force close
      if (closeTimeout) clearTimeout(closeTimeout)
      closeTimeout = setTimeout(() => {
        isForceClosing = true
        mainWindow?.close()
      }, 3000)
      mainWindow?.webContents.send('app:check-before-close')
    } else {
      // Clear any pending timeout when actually closing
      if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null }
    }
  })

  // Keep the renderer on the application page. External links are opened
  // explicitly in the user's browser; local file URLs must never navigate
  // the Electron renderer.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^(?:https?:\/\/|mailto:)/i.test(url)) {
      void shell.openExternal(url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?:\/\/|mailto:)/i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    const shouldQuit = isQuitRequested
    mainWindow = null
    rendererReady = false
    if (shouldQuit) {
      isQuitRequested = false
      // The original before-quit event was prevented while the renderer
      // checked dirty tabs. Re-issue the quit now that closing is approved.
      app.quit()
    } else {
      isForceClosing = false
    }
  })
}

function sendToRenderer(channel: string, ...args: any[]) {
  mainWindow?.webContents.send(channel, ...args)
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu:open'),
        },
        {
          label: 'Guardar',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToRenderer('menu:save'),
        },
        {
          label: 'Guardar como…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToRenderer('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Exportar PDF…',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendToRenderer('menu:export-pdf'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        {
          label: 'Solo editor',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendToRenderer('menu:view-edit'),
        },
        {
          label: 'Editor y vista previa',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendToRenderer('menu:view-split'),
        },
        {
          label: 'Solo vista previa',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendToRenderer('menu:view-preview'),
        },
        { type: 'separator' },
        {
          label: 'Tema oscuro',
          click: () => sendToRenderer('menu:theme-dark'),
        },
        {
          label: 'Tema claro',
          click: () => sendToRenderer('menu:theme-light'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function exportHtmlToPdf(html: string, suggestedName?: string) {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName?.replace(/\.(md|markdown|txt)$/i, '.pdf') ?? 'documento.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
    },
  })

  try {
    await pdfWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    )

    await new Promise<void>((resolve) => {
      if (pdfWindow.webContents.isLoading()) {
        pdfWindow.webContents.once('did-finish-load', () => resolve())
      } else {
        resolve()
      }
    })

    await pdfWindow.webContents.executeJavaScript(`
      (() => {
        const waitForImage = (image) => {
          if (image.complete) return Promise.resolve()
          return new Promise((resolve) => {
            let settled = false
            const finish = () => {
              if (settled) return
              settled = true
              resolve()
            }
            image.addEventListener('load', finish, { once: true })
            image.addEventListener('error', finish, { once: true })
            setTimeout(finish, 3000)
          })
        }
        return Promise.all(Array.from(document.images, waitForImage))
          .then(() => document.fonts?.ready)
      })()
    `)

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' },
      pageSize: 'A4',
    })

    await fs.writeFile(result.filePath, pdfBuffer)
    return { filePath: result.filePath, saved: true }
  } finally {
    pdfWindow.close()
  }
}

ipcMain.handle('dialog:openFile', async () => {
  try {
    // Do not attach this panel to a possibly unfocused/destroyed renderer
    // window. On macOS that can leave the native picker behind the app.
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    allowRoot(path.dirname(filePath))
    const content = await readTextFile(filePath)

    return { filePath, content }
  } catch (err) {
    console.error('Error opening file dialog:', err)
    return null
  }
})

ipcMain.handle('file:read', async (_event, filePath: string) => {
  try {
    if (!isAllowedPath(filePath)) {
      return null
    }
    const content = await readTextFile(filePath)
    return { filePath, content }
  } catch (err) {
    console.error('Error reading file:', err)
    return null
  }
})

ipcMain.handle('file:read-dropped', async (_event, filePath: string) => {
  try {
    if (!filePath || !path.isAbsolute(filePath)) return null
    allowRoot(path.dirname(filePath))
    const content = await readTextFile(filePath)
    return { filePath, content }
  } catch {
    return null
  }
})

ipcMain.handle('file:readAsDataUrl', async (_event, filePath: string) => {
  try {
    if (!isAllowedPath(filePath)) return null
    const buffer = await fs.readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
    }
    const mime = mimeTypes[ext] ?? 'application/octet-stream'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle(
  'dialog:saveFile',
  async (_event, content: string, currentPath?: string) => {
    try {
      if (currentPath) {
        if (!isAllowedPath(currentPath)) return null
        await fs.writeFile(currentPath, content, 'utf-8')
        return { filePath: currentPath, saved: true }
      }

      const result = await dialog.showSaveDialog({
        defaultPath: 'documento.md',
        filters: [
          { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      allowRoot(path.dirname(result.filePath))
      await fs.writeFile(result.filePath, content, 'utf-8')
      return { filePath: result.filePath, saved: true }
    } catch (err) {
      console.error('Error saving file:', err)
      return null
    }
  },
)

ipcMain.handle(
  'dialog:saveFileAs',
  async (_event, content: string, currentPath?: string) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: currentPath ?? 'documento.md',
        filters: [
          { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      allowRoot(path.dirname(result.filePath))
      await fs.writeFile(result.filePath, content, 'utf-8')
      return { filePath: result.filePath, saved: true }
    } catch (err) {
      console.error('Error in saveFileAs:', err)
      return null
    }
  },
)

ipcMain.handle(
  'export:pdf',
  async (_event, html: string, suggestedName?: string) => {
    try {
      return await exportHtmlToPdf(html, suggestedName)
    } catch (err) {
      console.error('Error exporting PDF:', err)
      return null
    }
  },
)

ipcMain.handle(
  'export:html',
  async (_event, htmlContent: string, suggestedName?: string) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: suggestedName?.replace(/\.(md|markdown|txt)$/i, '.html') ?? 'documento.html',
        filters: [{ name: 'HTML Document', extensions: ['html'] }],
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      await fs.writeFile(result.filePath, htmlContent, 'utf-8')
      return { filePath: result.filePath, saved: true }
    } catch (err) {
      console.error('Error exporting HTML:', err)
      return null
    }
  },
)

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})

ipcMain.handle('file:readKatexCss', async () => {
  // Try to read the local katex.min.css — first from the public/katex
  // directory (production build), then from node_modules (dev)
  const candidates = [
    path.join(__dirname, '../dist/katex/katex.min.css'),
    path.join(__dirname, '../public/katex/katex.min.css'),
    path.join(__dirname, '../node_modules/katex/dist/katex.min.css'),
  ]

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf-8')
    } catch {
      // try next candidate
    }
  }

  return null
})

let activeWatcher: ReturnType<typeof watch> | null = null

ipcMain.handle('dialog:openDirectory', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const dirPath = result.filePaths[0]
    allowRoot(dirPath)
    const dirName = path.basename(dirPath)
    return { path: dirPath, name: dirName }
  } catch (err) {
    console.error('Error in openDirectory dialog:', err)
    return null
  }
})

ipcMain.handle('dir:list', async (_event, dirPath: string) => {
  try {
    if (!isAllowedPath(dirPath)) return []
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      }))

    // Sort directories first, then alphabetically
    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

    return files
  } catch {
    return []
  }
})

ipcMain.handle('dir:watch', (_event, dirPath: string) => {
  if (!isAllowedPath(dirPath)) return false
  if (activeWatcher) {
    activeWatcher.close()
    activeWatcher = null
  }
  try {
    activeWatcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
      sendToRenderer('dir:changed', { eventType, filename })
    })
    return true
  } catch {
    return false
  }
})

ipcMain.handle('dir:unwatch', () => {
  if (activeWatcher) {
    activeWatcher.close()
    activeWatcher = null
  }
  return true
})

ipcMain.handle('file:create', async (_event, parentDirPath: string, fileName: string) => {
  try {
    if (!isAllowedPath(parentDirPath) || !isSafeFileName(fileName)) {
      return { error: 'Ruta o nombre de archivo no válido' }
    }
    const targetPath = path.join(
      parentDirPath,
      fileName.endsWith('.md') ? fileName : `${fileName}.md`
    )
    
    // Check if file already exists
    try {
      await fs.access(targetPath)
      return { error: 'El archivo ya existe' }
    } catch {
      // safe to proceed
    }

    await fs.writeFile(targetPath, '', 'utf-8')
    return { filePath: targetPath, content: '' }
  } catch (err: any) {
    return { error: err.message || 'No se pudo crear el archivo' }
  }
})

ipcMain.handle('file:saveClipboardImage', async (_event, activeFilePath: string, base64Data: string, imageName: string) => {
  try {
    if (
      !isAllowedPath(activeFilePath) ||
      !isSafeFileName(imageName) ||
      !/^[a-z0-9._-]+$/i.test(imageName) ||
      !/^[a-z]+;base64,[a-z0-9+/=\s]+$/i.test(`image/${path.extname(imageName).slice(1)};base64,${base64Data}`)
    ) {
      return { error: 'Ruta o imagen no válida' }
    }
    if (base64Data.length > 25 * 1024 * 1024) {
      return { error: 'La imagen supera el límite de 25 MB' }
    }
    const activeDir = path.dirname(activeFilePath)
    const assetsDir = path.join(activeDir, 'assets')

    // Ensure assets directory exists
    await fs.mkdir(assetsDir, { recursive: true })

    const targetPath = path.join(assetsDir, imageName)
    const buffer = Buffer.from(base64Data, 'base64')
    await fs.writeFile(targetPath, buffer)

    // Return the relative path to be inserted in the markdown
    return { relativePath: `./assets/${imageName}` }
  } catch (err: any) {
    return { error: err.message || 'No se pudo guardar la imagen del portapapeles' }
  }
})

async function performWorkspaceSearch(dirPath: string, query: string): Promise<any[]> {
  const results: any[] = []
  const lowerQuery = query.toLowerCase()

  const IGNORED_FOLDERS = new Set([
    'node_modules',
    '.git',
    'dist',
    'dist-electron',
    'release',
    'assets',
    '.DS_Store',
  ])

  async function searchDir(currentPath: string) {
    if (results.length >= 500) return
    let entries
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_FOLDERS.has(entry.name)) {
        continue
      }

      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await searchDir(fullPath)
      } else if (entry.isFile()) {
        const isText = MARKDOWN_FILE_REGEX.test(entry.name)
        if (!isText) continue

        try {
          const stats = await fs.stat(fullPath)
          if (stats.size > 5 * 1024 * 1024) continue
          const content = await readTextFile(fullPath)
          const lines = content.split('\n')
          const matches: { lineNumber: number; lineText: string }[] = []

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery) && matches.length < 100) {
              matches.push({
                lineNumber: i + 1,
                lineText: lines[i].trim(),
              })
            }
          }

          if (matches.length > 0) {
            results.push({
              filePath: fullPath,
              fileName: entry.name,
              matches,
            })
          }
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  await searchDir(dirPath)
  return results
}

ipcMain.handle('dir:search', async (_event, dirPath: string, query: string) => {
  if (!query.trim() || !isAllowedPath(dirPath)) return []
  return performWorkspaceSearch(dirPath, query)
})

async function findFileRecursively(dir: string, noteNames: readonly string[]): Promise<string | null> {
  const IGNORED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'assets'])

  async function search(currentPath: string): Promise<string | null> {
    let entries
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_FOLDERS.has(entry.name)) {
        continue
      }
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        const found = await search(fullPath)
        if (found) return found
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase()
        if (noteNames.some((noteName) => lowerName === noteName.toLowerCase())) {
          return fullPath
        }
      }
    }
    return null
  }

  return search(dir)
}

ipcMain.handle('file:resolveWikiLink', async (_event, { workspaceDirPath, activeFilePath, noteName }) => {
  const cleanNoteName = noteName.trim()
  if (!cleanNoteName || !isSafeFileName(cleanNoteName)) {
    return { error: 'Nombre de nota inválido' }
  }

  const noteNames = MARKDOWN_EXTENSIONS.map((extension) => `${cleanNoteName}.${extension}`)
  const mdName = `${cleanNoteName}.md`

  // 1. Search recursively in workspace if opened
  if (workspaceDirPath) {
    if (!isAllowedPath(workspaceDirPath)) return { error: 'Workspace no autorizado' }
    const foundPath = await findFileRecursively(workspaceDirPath, noteNames)
    if (foundPath) {
      return { filePath: foundPath, created: false }
    }
  }

  // 2. Fall back to current directory of the active file or workspace root
  let targetDir = workspaceDirPath
  if (activeFilePath) {
    targetDir = path.dirname(activeFilePath)
  }

  if (!targetDir) {
    return { error: 'No hay ninguna carpeta de espacio de trabajo o archivo activo para crear la nota' }
  }

  if (!isAllowedPath(targetDir)) return { error: 'Ruta de destino no autorizada' }
  const targetPath = path.join(targetDir, mdName)
  try {
    // Check if it already exists locally just in case
    await fs.access(targetPath)
    return { filePath: targetPath, created: false }
  } catch {
    // Create empty note with title heading template
    const template = `# ${cleanNoteName}\n\n`
    await fs.writeFile(targetPath, template, 'utf-8')
    return { filePath: targetPath, created: true }
  }
})

async function scanDirectoryRecursively(dirPath: string): Promise<any[]> {
  const results: any[] = []
  const IGNORED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'assets', '.DS_Store'])

  async function scan(currentPath: string) {
    let entries
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_FOLDERS.has(entry.name)) {
        continue
      }
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath)
      } else if (entry.isFile()) {
        const isTarget = MARKDOWN_FILE_REGEX.test(entry.name)
        if (isTarget) {
          results.push({
            name: entry.name,
            path: fullPath,
          })
        }
      }
    }
  }

  await scan(dirPath)
  return results
}

ipcMain.handle('dir:allFiles', async (_event, dirPath: string) => {
  if (!isAllowedPath(dirPath)) return []
  return scanDirectoryRecursively(dirPath)
})

ipcMain.handle('app:ready-to-open', () => {
  if (fileToOpen) {
    const temp = fileToOpen
    fileToOpen = null
    return temp
  }
  return null
})

ipcMain.on('app:file-opened', (_event, filePath: string) => {
  if (fileToOpen === filePath) fileToOpen = null
})

// ─── Unsaved-changes close flow ──────────────────────────

function clearCloseTimeout() {
  if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null }
}

ipcMain.on('app:dirty-state', (_event, hasDirty: boolean) => {
  clearCloseTimeout()

  if (!hasDirty) {
    isForceClosing = true
    mainWindow?.close()
    return
  }

  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!win || win.isDestroyed()) {
    // Window is gone, just quit
    isForceClosing = true
    app.quit()
    return
  }

  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Guardar y cerrar', 'Cerrar sin guardar', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    title: 'Cambios sin guardar',
    message: 'Tienes archivos con cambios sin guardar.',
    detail: '¿Qué deseas hacer antes de cerrar la aplicación?',
  })

  if (choice === 0) {
    mainWindow?.webContents.send('app:save-all-then-close')
  } else if (choice === 1) {
    isForceClosing = true
    mainWindow?.close()
  } else {
    // The native confirmation cancelled the pending quit request.
    isQuitRequested = false
  }
})

ipcMain.on('app:all-saved', () => {
  clearCloseTimeout()
  isForceClosing = true
  mainWindow?.close()
})

ipcMain.on('app:cancel-close', () => {
  clearCloseTimeout()
  isQuitRequested = false
  isForceClosing = false
})


app.whenReady().then(() => {
  loadAllowedRoots()
  protocol.handle('app-image', (request) => {
    const payload = request.url.slice('app-image://'.length)
    const encoded = payload.startsWith('local/') ? payload.slice('local/'.length) : payload
    const filePath = decodeURIComponent(encoded)
    if (!isAllowedPath(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).href)
  })

  buildMenu()
  createWindow()
  persistAllowedRoots()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// ⌘Q emits before-quit before the window's close event. Pause quitting while
// the renderer checks and resolves unsaved tabs.
app.on('before-quit', (event) => {
  if (isForceClosing || !mainWindow || mainWindow.isDestroyed()) return
  event.preventDefault()
  isQuitRequested = true
  mainWindow.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import fs from 'node:fs/promises'
import { watch, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'


// ─── Single instance lock ────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let fileToOpen: string | null = null
let isForceClosing = false

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('file:open-from-main', filePath)
  } else {
    fileToOpen = filePath
  }
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
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (saved.isMaximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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
      mainWindow?.webContents.send('app:check-before-close')
    }
  })

  // Prevent in-app navigation when clicking external links
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    // Allow navigation to the dev server or file:// (production)
    if (!url.startsWith(devServerUrl) && !url.startsWith('file://')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    isForceClosing = false
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
  const result = await dialog.showSaveDialog(mainWindow!, {
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
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  const content = await fs.readFile(filePath, 'utf-8')

  return { filePath, content }
})

ipcMain.handle('file:read', async (_event, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf-8')
  return { filePath, content }
})

ipcMain.handle('file:readAsDataUrl', async (_event, filePath: string) => {
  try {
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
    if (currentPath) {
      await fs.writeFile(currentPath, content, 'utf-8')
      return { filePath: currentPath, saved: true }
    }

    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: 'documento.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await fs.writeFile(result.filePath, content, 'utf-8')
    return { filePath: result.filePath, saved: true }
  },
)

ipcMain.handle(
  'dialog:saveFileAs',
  async (_event, content: string, currentPath?: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: currentPath ?? 'documento.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await fs.writeFile(result.filePath, content, 'utf-8')
    return { filePath: result.filePath, saved: true }
  },
)

ipcMain.handle(
  'export:pdf',
  async (_event, html: string, suggestedName?: string) => {
    return exportHtmlToPdf(html, suggestedName)
  },
)

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
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
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  const dirPath = result.filePaths[0]
  const dirName = path.basename(dirPath)
  return { path: dirPath, name: dirName }
})

ipcMain.handle('dir:list', async (_event, dirPath: string) => {
  try {
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
        const isText = /\.md$/i.test(entry.name) || /\.txt$/i.test(entry.name)
        if (!isText) continue

        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          const matches: { lineNumber: number; lineText: string }[] = []

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
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
  if (!query.trim()) return []
  return performWorkspaceSearch(dirPath, query)
})

async function findFileRecursively(dir: string, mdName: string, txtName: string): Promise<string | null> {
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
        if (lowerName === mdName.toLowerCase() || lowerName === txtName.toLowerCase()) {
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
  if (!cleanNoteName) {
    return { error: 'Nombre de nota inválido' }
  }

  const mdName = `${cleanNoteName}.md`
  const txtName = `${cleanNoteName}.txt`

  // 1. Search recursively in workspace if opened
  if (workspaceDirPath) {
    const foundPath = await findFileRecursively(workspaceDirPath, mdName, txtName)
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
        const isTarget = /\.md$/i.test(entry.name) || /\.txt$/i.test(entry.name)
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

// ─── Unsaved-changes close flow ──────────────────────────
ipcMain.on('app:dirty-state', (_event, hasDirty: boolean) => {
  if (!hasDirty) {
    isForceClosing = true
    mainWindow?.close()
    return
  }

  const choice = dialog.showMessageBoxSync(mainWindow!, {
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
  }
  // 2 = Cancelar → no hacer nada
})

ipcMain.on('app:all-saved', () => {
  isForceClosing = true
  mainWindow?.close()
})


app.whenReady().then(() => {
  protocol.handle('app-image', (request) => {
    const encoded = request.url.slice('app-image://'.length)
    const filePath = decodeURIComponent(encoded)
    return net.fetch(pathToFileURL(filePath).href)
  })

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron'

export type OpenFileResult = {
  filePath: string
  content: string
} | null

export type SaveFileResult = {
  filePath: string
  saved: boolean
} | null

const electronAPI = {
  openFile: (): Promise<OpenFileResult> => ipcRenderer.invoke('dialog:openFile'),

  readFile: (filePath: string): Promise<OpenFileResult> =>
    ipcRenderer.invoke('file:read', filePath),

  readAsDataUrl: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('file:readAsDataUrl', filePath),

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  saveFile: (content: string, currentPath?: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke('dialog:saveFile', content, currentPath),

  saveFileAs: (content: string, currentPath?: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke('dialog:saveFileAs', content, currentPath),

  exportPdf: (html: string, suggestedName?: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke('export:pdf', html, suggestedName),

  exportHtml: (htmlContent: string, suggestedName?: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke('export:html', htmlContent, suggestedName),

  readKatexCss: (): Promise<string | null> =>
    ipcRenderer.invoke('file:readKatexCss'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),

  openDirectory: (): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  readDirectory: (dirPath: string): Promise<{ name: string; path: string; isDirectory: boolean }[]> =>
    ipcRenderer.invoke('dir:list', dirPath),

  watchDirectory: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke('dir:watch', dirPath),

  unwatchDirectory: (): Promise<boolean> =>
    ipcRenderer.invoke('dir:unwatch'),

  createNewFile: (parentDirPath: string, fileName: string): Promise<{ filePath: string; content: string } | { error: string }> =>
    ipcRenderer.invoke('file:create', parentDirPath, fileName),

  saveClipboardImage: (activeFilePath: string, base64Data: string, imageName: string): Promise<{ relativePath: string } | { error: string }> =>
    ipcRenderer.invoke('file:saveClipboardImage', activeFilePath, base64Data, imageName),

  setZoomLevel: (level: number): void => webFrame.setZoomLevel(level),

  getZoomLevel: (): number => webFrame.getZoomLevel(),

  searchInDirectory: (dirPath: string, query: string): Promise<any> =>
    ipcRenderer.invoke('dir:search', dirPath, query),

  resolveWikiLink: (
    workspaceDirPath: string | null,
    activeFilePath: string | null,
    noteName: string
  ): Promise<any> =>
    ipcRenderer.invoke('file:resolveWikiLink', { workspaceDirPath, activeFilePath, noteName }),

  getAllFiles: (dirPath: string): Promise<any> =>
    ipcRenderer.invoke('dir:allFiles', dirPath),

  checkFileToOpen: (): Promise<string | null> =>
    ipcRenderer.invoke('app:ready-to-open'),

  onDirectoryChanged: (callback: (info: { eventType: string; filename: string | null }) => void) => {
    const handler = (_event: any, info: { eventType: string; filename: string | null }) => callback(info)
    ipcRenderer.on('dir:changed', handler)
    return () => {
      ipcRenderer.removeListener('dir:changed', handler)
    }
  },

  onMenuAction: (callback: (action: string) => void) => {
    const channels = [
      'menu:open',
      'menu:save',
      'menu:save-as',
      'menu:export-pdf',
      'menu:view-edit',
      'menu:view-split',
      'menu:view-preview',
      'menu:theme-dark',
      'menu:theme-light',
    ] as const

    const handlers = channels.map((channel) => {
      const handler = () => callback(channel)
      ipcRenderer.on(channel, handler)
      return { channel, handler }
    })

    return () => {
      for (const { channel, handler } of handlers) {
        ipcRenderer.removeListener(channel, handler)
      }
    }
  },
  onOpenFile: (callback: (filePath: string) => void) => {
    const handler = (_event: any, filePath: string) => callback(filePath)
    ipcRenderer.on('file:open-from-main', handler)
    return () => {
      ipcRenderer.removeListener('file:open-from-main', handler)
    }
  },

  // ── Unsaved-changes close flow ──
  onBeforeClose: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('app:check-before-close', handler)
    return () => ipcRenderer.removeListener('app:check-before-close', handler)
  },
  onSaveAllThenClose: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('app:save-all-then-close', handler)
    return () => ipcRenderer.removeListener('app:save-all-then-close', handler)
  },
  reportDirtyState: (hasDirty: boolean): void => { ipcRenderer.send('app:dirty-state', hasDirty) },
  reportAllSaved: (): void => { ipcRenderer.send('app:all-saved') },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI

export type OpenFileResult = {
  filePath: string
  content: string
} | null

export type SaveFileResult = {
  filePath: string
  saved: boolean
} | null

export type ElectronAPI = {
  openFile: () => Promise<OpenFileResult>
  readFile: (filePath: string) => Promise<OpenFileResult>
  readAsDataUrl: (filePath: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  saveFile: (content: string, currentPath?: string) => Promise<SaveFileResult>
  saveFileAs: (content: string, currentPath?: string) => Promise<SaveFileResult>
  exportPdf: (html: string, suggestedName?: string) => Promise<SaveFileResult>
  readKatexCss: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  openDirectory: () => Promise<{ path: string; name: string } | null>
  readDirectory: (dirPath: string) => Promise<{ name: string; path: string; isDirectory: boolean }[]>
  watchDirectory: (dirPath: string) => Promise<boolean>
  unwatchDirectory: () => Promise<boolean>
  createNewFile: (parentDirPath: string, fileName: string) => Promise<{ filePath: string; content: string } | { error: string }>
  saveClipboardImage: (activeFilePath: string, base64Data: string, imageName: string) => Promise<{ relativePath: string } | { error: string }>
  setZoomLevel: (level: number) => void
  getZoomLevel: () => number
  onDirectoryChanged: (callback: (info: { eventType: string; filename: string | null }) => void) => () => void
  onMenuAction: (callback: (action: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

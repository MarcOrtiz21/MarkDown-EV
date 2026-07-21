export function hasElectronAPI(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

export function getElectronAPI() {
  if (!hasElectronAPI()) {
    throw new Error('Electron API no disponible')
  }
  return window.electronAPI
}

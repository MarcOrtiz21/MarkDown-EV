export type AppConfig = {
  fontSize: number
  fontFamily: string
  lineHeight: number
  autoSave: boolean
  autoSaveDelay: number
  vimMode: boolean
  tabSize: number
}

export const DEFAULT_CONFIG: AppConfig = {
  fontSize: 14,
  fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
  lineHeight: 1.6,
  autoSave: true,
  autoSaveDelay: 2, // in seconds
  vimMode: false,
  tabSize: 4,
}

export function getAppConfig(): AppConfig {
  try {
    const stored = localStorage.getItem('markdown-ev:config')
    if (!stored) return DEFAULT_CONFIG
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG
    const value = parsed as Partial<AppConfig>
    return {
      fontSize: typeof value.fontSize === 'number' && value.fontSize >= 12 && value.fontSize <= 24
        ? value.fontSize
        : DEFAULT_CONFIG.fontSize,
      fontFamily: typeof value.fontFamily === 'string' ? value.fontFamily : DEFAULT_CONFIG.fontFamily,
      lineHeight: typeof value.lineHeight === 'number' && value.lineHeight >= 1.2 && value.lineHeight <= 2.5
        ? value.lineHeight
        : DEFAULT_CONFIG.lineHeight,
      autoSave: typeof value.autoSave === 'boolean' ? value.autoSave : DEFAULT_CONFIG.autoSave,
      autoSaveDelay: typeof value.autoSaveDelay === 'number' && value.autoSaveDelay >= 1 && value.autoSaveDelay <= 10
        ? value.autoSaveDelay
        : DEFAULT_CONFIG.autoSaveDelay,
      vimMode: typeof value.vimMode === 'boolean' ? value.vimMode : DEFAULT_CONFIG.vimMode,
      tabSize: value.tabSize === 2 || value.tabSize === 4 ? value.tabSize : DEFAULT_CONFIG.tabSize,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveAppConfig(config: AppConfig) {
  try {
    localStorage.setItem('markdown-ev:config', JSON.stringify(config))
  } catch {
    // ignore
  }
}

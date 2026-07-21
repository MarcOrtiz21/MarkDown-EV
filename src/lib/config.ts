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
    return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
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

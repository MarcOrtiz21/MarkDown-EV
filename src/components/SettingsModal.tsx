import { useEffect, useState } from 'react'
import type { AppConfig } from '../lib/config'
import { DEFAULT_CONFIG } from '../lib/config'
import { CloseIcon } from './Icons'

type SettingsModalProps = {
  isOpen: boolean
  config: AppConfig
  onClose: () => void
  onSaveConfig: (config: AppConfig) => void
}

const FONT_FAMILIES = [
  { name: 'Monoespacio del sistema', value: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' },
  { name: 'Fira Code', value: '"Fira Code", Fira Mono, monospace' },
  { name: 'Courier New', value: '"Courier New", Courier, monospace' },
  { name: 'Consolas / Monaco', value: 'Consolas, Monaco, monospace' },
]

export function SettingsModal({
  isOpen,
  config,
  onClose,
  onSaveConfig,
}: SettingsModalProps) {
  const [tempConfig, setTempConfig] = useState<AppConfig>({ ...config })

  // Synchronize state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTempConfig({ ...config })
    }
  }, [isOpen, config])

  // Keybindings listener inside modal (Escape to close)
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleChange = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setTempConfig((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSave = () => {
    onSaveConfig(tempConfig)
    onClose()
  }

  const handleReset = () => {
    setTempConfig({ ...DEFAULT_CONFIG })
  }

  if (!isOpen) return null

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="settings-modal-header">
          <h2>Preferencias</h2>
          <button type="button" className="settings-close-btn" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>

        <main className="settings-modal-body">
          {/* 1. Fuente del Editor */}
          <div className="settings-section">
            <h3>Aspecto del Editor</h3>
            
            <div className="settings-row">
              <div className="settings-label-group">
                <label>Tipografía</label>
                <span className="settings-description">Fuente utilizada para la edición del documento.</span>
              </div>
              <select
                value={tempConfig.fontFamily}
                onChange={(e) => handleChange('fontFamily', e.target.value)}
                className="settings-control select"
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label-group">
                <label>Tamaño de Letra ({tempConfig.fontSize}px)</label>
                <span className="settings-description">Ajusta el tamaño del texto en el área de edición.</span>
              </div>
              <input
                type="range"
                min="12"
                max="24"
                step="1"
                value={tempConfig.fontSize}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                className="settings-control range"
              />
            </div>

            <div className="settings-row">
              <div className="settings-label-group">
                <label>Interlineado</label>
                <span className="settings-description">Espaciado de líneas verticales.</span>
              </div>
              <select
                value={tempConfig.lineHeight}
                onChange={(e) => handleChange('lineHeight', parseFloat(e.target.value))}
                className="settings-control select select-small"
              >
                <option value="1.4">1.4 (Compacto)</option>
                <option value="1.6">1.6 (Normal)</option>
                <option value="1.8">1.8 (Espacioso)</option>
                <option value="2.0">2.0 (Doble)</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label-group">
                <label>Tamaño de Tabulación</label>
                <span className="settings-description">Espacios insertados al presionar la tecla Tab.</span>
              </div>
              <select
                value={tempConfig.tabSize}
                onChange={(e) => handleChange('tabSize', parseInt(e.target.value))}
                className="settings-control select select-small"
              >
                <option value="2">2 espacios</option>
                <option value="4">4 espacios</option>
              </select>
            </div>
          </div>

          {/* 2. Comportamiento y Guardado */}
          <div className="settings-section">
            <h3>Comportamiento y Guardado</h3>

            <div className="settings-row">
              <div className="settings-label-group">
                <label>Auto-guardar Cambios</label>
                <span className="settings-description">Guarda las modificaciones en segundo plano al parar de escribir.</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={tempConfig.autoSave}
                  onChange={(e) => handleChange('autoSave', e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            {tempConfig.autoSave && (
              <div className="settings-row">
                <div className="settings-label-group">
                  <label>Espera de Auto-guardado ({tempConfig.autoSaveDelay} seg)</label>
                  <span className="settings-description">Tiempo transcurrido antes de persistir los cambios al parar de escribir.</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={tempConfig.autoSaveDelay}
                  onChange={(e) => handleChange('autoSaveDelay', parseInt(e.target.value))}
                  className="settings-control range"
                />
              </div>
            )}
          </div>

          {/* 3. Atajos y Modos Especiales */}
          <div className="settings-section">
            <h3>Modos Especiales</h3>

            <div className="settings-row">
              <div className="settings-label-group">
                <label>Modo VIM</label>
                <span className="settings-description">Activa los atajos y el cursor en bloque característicos de VIM.</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={tempConfig.vimMode}
                  onChange={(e) => handleChange('vimMode', e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </main>

        <footer className="settings-modal-footer">
          <button type="button" className="settings-btn btn-reset" onClick={handleReset}>
            Restablecer pred.
          </button>
          <div className="settings-btn-actions">
            <button type="button" className="settings-btn btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="settings-btn btn-save" onClick={handleSave}>
              Guardar Ajustes
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

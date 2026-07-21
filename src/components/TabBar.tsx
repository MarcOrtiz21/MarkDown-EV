import { FileIcon, CloseIcon } from './Icons'

type Tab = {
  id: string
  filePath: string | null
  content: string
  savedContent: string
}

type TabBarProps = {
  tabs: Tab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export function TabBar({ tabs, activeTabId, onTabSelect, onTabClose }: TabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isDirty = tab.content !== tab.savedContent
        const title = tab.filePath
          ? tab.filePath.split(/[/\\]/).pop() || 'Sin título'
          : 'Sin título'
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            title={tab.filePath ?? 'Documento sin guardar'}
          >
            <FileIcon className="tab-icon" size={13} />
            <span className="tab-title">{title}</span>
            {isDirty && <span className="tab-dirty-indicator" title="Modificado" />}
            <button
              type="button"
              className="tab-close-btn"
              title="Cerrar pestaña"
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
export type { Tab }

import { useState } from 'react'
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
  onTabReorder?: (fromIndex: number, toIndex: number) => void
}

export function TabBar({ tabs, activeTabId, onTabSelect, onTabClose, onTabReorder }: TabBarProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  if (tabs.length === 0) return null

  const handleDragStart = (index: number, e: React.DragEvent) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (index: number, e: React.DragEvent) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== index && onTabReorder) {
      onTabReorder(draggedIndex, index)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => {
        const isDirty = tab.content !== tab.savedContent
        const title = tab.filePath
          ? tab.filePath.split(/[/\\]/).pop() || 'Sin título'
          : 'Sin título'
        const isActive = tab.id === activeTabId
        const isDragging = draggedIndex === index
        const isDragOver = dragOverIndex === index

        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(index, e)}
            onDragOver={(e) => handleDragOver(index, e)}
            onDrop={(e) => handleDrop(index, e)}
            onDragEnd={handleDragEnd}
            className={`tab-item ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''} ${
              isDragging ? 'dragging' : ''
            } ${isDragOver ? 'drag-over' : ''}`}
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

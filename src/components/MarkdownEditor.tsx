import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentUnit } from '@codemirror/language'
import { vim } from '@replit/codemirror-vim'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { Theme } from '../lib/theme'
import { formattingKeymap } from '../lib/formatting'
import { search, searchKeymap } from '@codemirror/search'

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  theme: Theme
  fontSize: number
  fontFamily: string
  lineHeight: number
  tabSize: number
  vimMode: boolean
  focusMode?: boolean
  typewriterMode?: boolean
  /** Called when the editor scrolls — reports the first visible line (0-based). */
  onScroll?: (firstVisibleLine: number) => void
  /** Imperative handle so the parent can scroll the editor to a line. */
  editorRef?: React.MutableRefObject<{ scrollToLine: (line: number) => void } | null>
  /** Called when the user pastes or drops an image file. */
  onPasteImage?: (file: File, insertCallback: (relativePath: string) => void) => void
}

const themeCompartment = new Compartment()
const styleCompartment = new Compartment()
const tabSizeCompartment = new Compartment()
const vimCompartment = new Compartment()

const lightEditorTheme = EditorView.theme({
  '&': {
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  '.cm-content': { caretColor: '#1a1a1a' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1a1a1a' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#d6d6ff',
  },
  '.cm-activeLine': { backgroundColor: '#f5f5f7' },
  '.cm-gutters': {
    backgroundColor: '#f8f8f8',
    color: '#999',
    borderRight: '1px solid #e5e5e5',
  },
  '.cm-activeLineGutter': { backgroundColor: '#efefef' },
})

function editorTheme(theme: Theme) {
  return themeCompartment.of(theme === 'dark' ? oneDark : lightEditorTheme)
}

export function MarkdownEditor({
  value,
  onChange,
  theme,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  vimMode,
  focusMode = false,
  typewriterMode = false,
  onScroll,
  editorRef,
  onPasteImage,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onScrollRef = useRef(onScroll)
  const initialValueRef = useRef(value)
  const themeRef = useRef(theme)
  const onPasteImageRef = useRef(onPasteImage)

  useEffect(() => {
    onPasteImageRef.current = onPasteImage
  }, [onPasteImage])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onScrollRef.current = onScroll
  }, [onScroll])

  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  // Expose imperative scrollToLine
  useEffect(() => {
    if (!editorRef) return
    editorRef.current = {
      scrollToLine(line: number) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        // Clamp line to valid range (0-based from the caller, CodeMirror uses 1-based)
        const lineNumber = Math.min(Math.max(line + 1, 1), doc.lines)
        const lineInfo = doc.line(lineNumber)
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: 'start' }),
        })
      },
    }
    return () => {
      editorRef.current = null
    }
  }, [editorRef])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        formattingKeymap,
        search({ top: true }),
        markdown({ base: markdownLanguage }),
        editorTheme(themeRef.current),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
        }),
        // Scroll listener — fires on viewport changes
        EditorView.updateListener.of((update) => {
          if (update.viewportChanged || update.geometryChanged) {
            const callback = onScrollRef.current
            if (!callback) return
            const view = update.view
            // Get the first visible line
            const topBlock = view.lineBlockAtHeight(view.viewport.from - view.documentTop)
            const line = view.state.doc.lineAt(topBlock.from)
            callback(line.number - 1) // 0-based
          }
        }),
        // Paste and Drop event handlers — intercepts image files
        EditorView.domEventHandlers({
          paste(event, view) {
            const file = event.clipboardData?.files[0]
            if (file && file.type.startsWith('image/') && onPasteImageRef.current) {
              event.preventDefault()
              onPasteImageRef.current(file, (relativePath) => {
                const { from, to } = view.state.selection.main
                const textToInsert = `![Imagen](${relativePath})`
                view.dispatch({
                  changes: { from, to, insert: textToInsert },
                  selection: { anchor: from + textToInsert.length },
                })
              })
              return true
            }
            return false
          },
          drop(event, view) {
            const file = event.dataTransfer?.files[0]
            if (file && file.type.startsWith('image/') && onPasteImageRef.current) {
              event.preventDefault()
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
              onPasteImageRef.current(file, (relativePath) => {
                const textToInsert = `![${file.name}](${relativePath})`
                view.dispatch({
                  changes: { from: pos, to: pos, insert: textToInsert },
                  selection: { anchor: pos + textToInsert.length },
                })
              })
              return true
            }
            return false
          },
        }),
        // Compartments for dynamic preferences config
        styleCompartment.of(
          EditorView.theme({
            '.cm-content, .cm-gutter, .cm-scroller': {
              fontSize: `${fontSize}px !important`,
              fontFamily: `${fontFamily} !important`,
              lineHeight: `${lineHeight} !important`,
            },
          })
        ),
        tabSizeCompartment.of([
          EditorState.tabSize.of(tabSize),
          indentUnit.of(' '.repeat(tabSize)),
        ]),
        vimCompartment.of(vimMode ? vim() : []),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: themeCompartment.reconfigure(
        theme === 'dark' ? oneDark : lightEditorTheme,
      ),
    })
  }, [theme])

  // Reactively reconfigure dynamic editor configurations on props changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: [
        styleCompartment.reconfigure(
          EditorView.theme({
            '.cm-content, .cm-gutter, .cm-scroller': {
              fontSize: `${fontSize}px !important`,
              fontFamily: `${fontFamily} !important`,
              lineHeight: `${lineHeight} !important`,
            },
          })
        ),
        tabSizeCompartment.reconfigure([
          EditorState.tabSize.of(tabSize),
          indentUnit.of(' '.repeat(tabSize)),
        ]),
        vimCompartment.reconfigure(vimMode ? vim() : []),
      ],
    })
  }, [fontSize, fontFamily, lineHeight, tabSize, vimMode])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className={`markdown-editor ${focusMode ? 'focus-mode-active' : ''} ${
        typewriterMode ? 'typewriter-active' : ''
      }`}
    />
  )
}


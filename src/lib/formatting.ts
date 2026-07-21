import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'

/**
 * Wrap the current selection with `before` and `after` markers.
 * If nothing is selected, insert the markers and place the cursor between them.
 */
function wrapSelection(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)

  // If the selection is already wrapped, unwrap it
  const textBefore = view.state.sliceDoc(
    Math.max(0, from - before.length),
    from,
  )
  const textAfter = view.state.sliceDoc(to, to + after.length)

  if (textBefore === before && textAfter === after) {
    view.dispatch({
      changes: [
        { from: from - before.length, to: from, insert: '' },
        { from: to, to: to + after.length, insert: '' },
      ],
      selection: {
        anchor: from - before.length,
        head: to - before.length,
      },
    })
    return true
  }

  if (selected.length === 0) {
    // Nothing selected — insert markers and place cursor between them
    view.dispatch({
      changes: { from, to, insert: `${before}${after}` },
      selection: { anchor: from + before.length },
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selected.length,
      },
    })
  }
  return true
}

function insertCodeBlock(view: EditorView) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)

  const insert = selected.length > 0
    ? `\n\`\`\`\n${selected}\n\`\`\`\n`
    : '\n```\n\n```\n'

  const cursorOffset = selected.length > 0
    ? insert.length
    : 5 // after opening ``` and newline

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
  })
  return true
}

export const formattingKeymap = keymap.of([
  {
    key: 'Mod-b',
    run: (view) => wrapSelection(view, '**', '**'),
  },
  {
    key: 'Mod-i',
    run: (view) => wrapSelection(view, '_', '_'),
  },
  {
    key: 'Mod-k',
    run: (view) => {
      const { from, to } = view.state.selection.main
      const selected = view.state.sliceDoc(from, to)

      if (selected.length === 0) {
        const insert = '[](url)'
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + 1 }, // cursor inside []
        })
      } else {
        const insert = `[${selected}](url)`
        view.dispatch({
          changes: { from, to, insert },
          selection: {
            anchor: from + selected.length + 3,
            head: from + selected.length + 6,
          }, // select "url"
        })
      }
      return true
    },
  },
  {
    key: 'Mod-Shift-c',
    run: insertCodeBlock,
  },
])

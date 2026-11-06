import AppKit
import SwiftUI

/// Imperative handle used by the document window to drive the editor
/// (scroll sync, outline navigation, task toggles from the preview).
@MainActor
final class EditorController {
    fileprivate weak var textView: MarkdownTextView?
    /// User-driven scrolling only; used to keep the preview in sync.
    var onTopLineChange: ((Int) -> Void)?
    /// Every change of the first visible line, including programmatic scrolls.
    var onVisibleLineChange: ((Int) -> Void)?
    /// Current Vim mode, or `nil` when Vim mode is off.
    var onVimModeChange: ((VimMode?) -> Void)? {
        didSet { textView?.onVimModeChange = onVimModeChange }
    }

    private var lineStarts: [Int]?
    private var ignoreScrollUntil = Date.distantPast

    func focus() {
        guard let textView else { return }
        textView.window?.makeFirstResponder(textView)
    }

    func scrollTo(line: Int, select: Bool = false) {
        guard let textView,
              let layoutManager = textView.layoutManager,
              let container = textView.textContainer,
              let scrollView = textView.enclosingScrollView
        else { return }

        let starts = currentLineStarts()
        let location = starts[min(max(line, 0), starts.count - 1)]
        let glyphRange = layoutManager.glyphRange(
            forCharacterRange: NSRange(location: location, length: 0),
            actualCharacterRange: nil
        )
        layoutManager.ensureLayout(forGlyphRange: NSRange(location: 0, length: glyphRange.location + 1))
        let rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: container)
        let y = max(0, rect.minY + textView.textContainerOrigin.y - 12)

        ignoreScrollUntil = Date().addingTimeInterval(0.25)
        scrollView.contentView.scroll(to: NSPoint(x: 0, y: y))
        scrollView.reflectScrolledClipView(scrollView.contentView)

        if select {
            textView.setSelectedRange(NSRange(location: location, length: 0))
            focus()
        }
    }

    /// Scrolls to `line`, selects the first occurrence of `text` on it and flashes it.
    func reveal(line: Int, highlighting text: String?) {
        scrollTo(line: line, select: true)
        guard let textView, let text, !text.isEmpty,
              let lineRange = MarkdownText.lineRange(in: textView.string as NSString, line: line)
        else { return }
        let match = (textView.string as NSString).range(
            of: text,
            options: [.caseInsensitive, .diacriticInsensitive],
            range: lineRange
        )
        guard match.location != NSNotFound else { return }
        textView.setSelectedRange(match)
        textView.showFindIndicator(for: match)
    }

    func setTask(line: Int, checked: Bool) {
        guard let textView else { return }
        let text = textView.string as NSString
        guard let range = MarkdownText.taskMarkerRange(in: text, line: line) else { return }
        replace(range, with: checked ? "x" : " ", actionName: "Marcar tarea")
    }

    func replace(_ range: NSRange, with replacement: String, actionName: String) {
        guard let textView, textView.shouldChangeText(in: range, replacementString: replacement) else { return }
        textView.textStorage?.replaceCharacters(in: range, with: replacement)
        textView.didChangeText()
        textView.undoManager?.setActionName(actionName)
    }

    fileprivate func textDidChange() {
        lineStarts = nil
    }

    fileprivate func visibleRegionDidChange() {
        guard let textView,
              let layoutManager = textView.layoutManager,
              let container = textView.textContainer
        else { return }

        let visible = textView.visibleRect
        let line: Int
        if visible.maxY >= textView.bounds.maxY - 2, visible.minY > 0 {
            // At the very end the last sections can never reach the top edge.
            line = currentLineStarts().count - 1
        } else {
            var point = visible.origin
            point.y -= textView.textContainerOrigin.y
            let glyph = layoutManager.glyphIndex(for: point, in: container)
            line = self.line(containing: layoutManager.characterIndexForGlyph(at: glyph))
        }

        onVisibleLineChange?(line)
        if Date() >= ignoreScrollUntil {
            onTopLineChange?(line)
        }
    }

    private func currentLineStarts() -> [Int] {
        if let lineStarts { return lineStarts }
        var starts = [0]
        let text = (textView?.string ?? "") as NSString
        var searchStart = 0
        while searchStart < text.length {
            let found = text.range(of: "\n", range: NSRange(location: searchStart, length: text.length - searchStart))
            guard found.location != NSNotFound else { break }
            starts.append(found.location + 1)
            searchStart = found.location + 1
        }
        lineStarts = starts
        return starts
    }

    private func line(containing location: Int) -> Int {
        let starts = currentLineStarts()
        var low = 0
        var high = starts.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if starts[mid] <= location { low = mid } else { high = mid - 1 }
        }
        return low
    }
}

final class MarkdownTextView: NSTextView {
    var readableWidth: CGFloat = 780
    /// Location of the document on disk, needed to store pasted images next to it.
    var documentURL: URL?
    private(set) var vim: VimEngine?
    var onVimModeChange: ((VimMode?) -> Void)?
    private let blockCursor = NSView()

    func setVimEnabled(_ enabled: Bool) {
        guard enabled != (vim != nil) else { return }
        if enabled {
            let engine = VimEngine(textView: self)
            engine.onModeChange = { [weak self] mode in
                self?.updateBlockCursor()
                self?.onVimModeChange?(mode)
            }
            vim = engine
            engine.reset()
            onVimModeChange?(engine.mode)
        } else {
            vim = nil
            onVimModeChange?(nil)
        }
        updateBlockCursor()
    }

    override func keyDown(with event: NSEvent) {
        // Keys that belong to an input method composition (dead keys, accents) stay with it.
        if let vim, !hasMarkedText(), vim.handle(event) {
            updateBlockCursor()
            return
        }
        super.keyDown(with: event)
    }

    override func setSelectedRanges(_ ranges: [NSValue], affinity: NSSelectionAffinity, stillSelecting: Bool) {
        super.setSelectedRanges(ranges, affinity: affinity, stillSelecting: stillSelecting)
        updateBlockCursor()
    }

    override func didChangeText() {
        super.didChangeText()
        updateBlockCursor()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateBlockCursor()
    }

    /// Normal and visual modes show a block over the character instead of the caret.
    private func updateBlockCursor() {
        guard let vim, vim.wantsBlockCursor, let rect = blockCursorRect(at: vim.cursorLocation) else {
            blockCursor.removeFromSuperview()
            insertionPointColor = .textInsertionPointColor
            return
        }
        insertionPointColor = .clear
        if blockCursor.superview == nil {
            blockCursor.wantsLayer = true
            blockCursor.layer?.cornerRadius = 2
            addSubview(blockCursor)
        }
        blockCursor.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.4).cgColor
        blockCursor.frame = rect
    }

    private func blockCursorRect(at location: Int) -> NSRect? {
        guard let layoutManager, let textContainer, let font else { return nil }
        let text = string as NSString
        let lineHeight = layoutManager.defaultLineHeight(for: font)
        let spaceWidth = (" " as NSString).size(withAttributes: [.font: font]).width
        var rect: NSRect
        if location >= text.length {
            let extra = layoutManager.extraLineFragmentRect
            if !extra.isEmpty || text.length == 0 {
                rect = NSRect(x: extra.minX, y: extra.minY, width: spaceWidth, height: max(extra.height, lineHeight))
            } else {
                let glyph = layoutManager.glyphIndexForCharacter(at: text.length - 1)
                let last = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: textContainer)
                rect = NSRect(x: last.maxX, y: last.minY, width: spaceWidth, height: last.height)
            }
        } else {
            let characters = text.rangeOfComposedCharacterSequence(at: location)
            let glyphs = layoutManager.glyphRange(forCharacterRange: characters, actualCharacterRange: nil)
            rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
            if text.character(at: location) == 10 || rect.width < 1 { rect.size.width = spaceWidth }
        }
        // Extra line spacing sits above the glyphs, so hug the text instead of the whole fragment.
        let height = min(rect.height, lineHeight)
        rect.origin.y = rect.maxY - height
        rect.size.height = height
        return rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y).integral
    }

    override func paste(_ sender: Any?) {
        if !insertImages(from: .general) {
            super.paste(sender)
        }
    }

    override func dragOperation(for dragInfo: any NSDraggingInfo, type: NSPasteboard.PasteboardType) -> NSDragOperation {
        ImageImporter.containsImage(dragInfo.draggingPasteboard) ? .copy : super.dragOperation(for: dragInfo, type: type)
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        guard ImageImporter.containsImage(sender.draggingPasteboard) else {
            return super.performDragOperation(sender)
        }
        let point = convert(sender.draggingLocation, from: nil)
        setSelectedRange(NSRange(location: characterIndexForInsertion(at: point), length: 0))
        return insertImages(from: sender.draggingPasteboard)
    }

    /// Returns `false` when the pasteboard holds no images, so the default behaviour applies.
    private func insertImages(from pasteboard: NSPasteboard) -> Bool {
        do {
            guard let markdown = try ImageImporter.markdown(for: pasteboard, documentURL: documentURL) else { return false }
            insertText(markdown, replacementRange: selectedRange())
            undoManager?.setActionName("Insertar imagen")
        } catch {
            if let window {
                presentError(error, modalFor: window, delegate: nil, didPresent: nil, contextInfo: nil)
            } else {
                presentError(error)
            }
        }
        return true
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let horizontal = max(28, (newSize.width - readableWidth) / 2)
        if abs(textContainerInset.width - horizontal) > 0.5 {
            textContainerInset = NSSize(width: horizontal, height: 28)
        }
        updateBlockCursor()
    }
}

struct MarkdownEditor: NSViewRepresentable {
    @ObservedObject var document: MarkdownDocument
    let controller: EditorController
    let settings: EditorSettings
    let fileURL: URL?
    @Environment(\.undoManager) private var undoManager

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false

        let textView = MarkdownTextView(usingTextLayoutManager: false)
        textView.minSize = .zero
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true

        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.drawsBackground = true
        textView.backgroundColor = .textBackgroundColor
        textView.setAccessibilityLabel("Editor Markdown")

        textView.string = document.text
        textView.documentURL = fileURL
        textView.registerForDraggedTypes([.fileURL, .png, .tiff])
        textView.onVimModeChange = controller.onVimModeChange
        context.coordinator.apply(settings, to: textView)
        textView.delegate = context.coordinator

        scrollView.documentView = textView
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.boundsDidChange(_:)),
            name: NSView.boundsDidChangeNotification,
            object: scrollView.contentView
        )

        controller.textView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? MarkdownTextView else { return }
        controller.textView = textView
        textView.documentURL = fileURL
        if textView.string != document.text {
            // The document was replaced from outside the editor (revert, external change).
            let selection = textView.selectedRanges
            textView.string = document.text
            controller.textDidChange()
            let length = (document.text as NSString).length
            textView.selectedRanges = selection.map {
                let range = $0.rangeValue
                return NSValue(range: NSRange(location: min(range.location, length), length: 0))
            }
        }
        if context.coordinator.appliedSettings != settings {
            context.coordinator.apply(settings, to: textView)
        }
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        NotificationCenter.default.removeObserver(coordinator)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownEditor
        private(set) var highlighter = MarkdownHighlighter()
        private(set) var appliedSettings: EditorSettings?

        init(parent: MarkdownEditor) {
            self.parent = parent
        }

        func apply(_ settings: EditorSettings, to textView: MarkdownTextView) {
            appliedSettings = settings
            highlighter = MarkdownHighlighter(settings: settings)
            textView.font = highlighter.baseFont
            textView.typingAttributes = highlighter.baseAttributes
            textView.defaultParagraphStyle = highlighter.paragraphStyle
            textView.isContinuousSpellCheckingEnabled = settings.spellCheck
            textView.readableWidth = CGFloat(settings.readableWidth)
            textView.setVimEnabled(settings.vimMode)
            textView.setFrameSize(textView.frame.size)
            if let storage = textView.textStorage {
                storage.delegate = highlighter
                highlighter.highlight(storage)
            }
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.controller.textDidChange()
            parent.document.text = textView.string
        }

        func undoManager(for view: NSTextView) -> UndoManager? {
            parent.undoManager
        }

        @objc func boundsDidChange(_ notification: Notification) {
            parent.controller.visibleRegionDidChange()
        }
    }
}

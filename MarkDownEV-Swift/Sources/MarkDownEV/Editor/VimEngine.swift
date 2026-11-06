import AppKit

enum VimMode: Equatable {
    case normal
    case insert
    case visual
    case visualLine
    case command(String)

    var label: String {
        switch self {
        case .normal: "NORMAL"
        case .insert: "INSERTAR"
        case .visual: "VISUAL"
        case .visualLine: "V-LÍNEA"
        case .command(let line): ":" + line
        }
    }

    var isVisual: Bool { self == .visual || self == .visualLine }
}

/// A practical subset of Vim on top of `NSTextView`: motions, operators with
/// counts and text objects, visual modes, registers, `.` repeat and a few `:` commands.
@MainActor
final class VimEngine {
    static let escape = "\u{1b}"
    private static let indentUnit = "    "

    private unowned let textView: NSTextView
    /// Unnamed register mirror; tests pass a private board so they never touch the user's clipboard.
    var pasteboard: NSPasteboard? = .general
    var onModeChange: ((VimMode) -> Void)?

    private(set) var mode: VimMode = .normal {
        didSet {
            guard mode != oldValue else { return }
            onModeChange?(mode)
        }
    }

    /// End of the visual selection the cursor sits on; the anchor is the other end.
    private(set) var head = 0
    private var anchor = 0

    private enum Operator: String {
        case delete = "d", change = "c", yank = "y", indent = ">", outdent = "<"
    }

    private enum Prefix {
        case g
        case find(String)
        case replace
        case textObject(inner: Bool)
    }

    private enum MotionKind { case exclusive, inclusive, linewise }

    private struct Target {
        var location: Int
        var kind: MotionKind
    }

    private struct Change {
        var keys: [String]
        var inserted: String?
    }

    private var count: Int?
    private var operatorCount: Int?
    private var pendingOperator: Operator?
    private var pendingPrefix: Prefix?
    private var desiredColumn: Int?
    private var lastFind: (kind: String, character: String)?
    private var register = (text: "", linewise: false)

    private var keys: [String] = []
    private var lastChange: Change?
    private var insertChange: (keys: [String], start: Int, changed: Bool)?
    private var didChange = false
    private var isReplaying = false

    init(textView: NSTextView) {
        self.textView = textView
        head = textView.selectedRange().location
    }

    var wantsBlockCursor: Bool { mode != .insert }

    /// Location of the block cursor, `head` in visual modes.
    var cursorLocation: Int { mode.isVisual ? head : textView.selectedRange().location }

    // MARK: - Input

    /// Returns `false` for keys the text view should handle itself.
    func handle(_ key: String, control: Bool = false) -> Bool {
        if case .command(let line) = mode {
            handleCommandLine(key, line: line)
            return true
        }
        let isEscape = key == Self.escape || (control && (key == "[" || key == "c"))
        if mode == .insert {
            guard isEscape else { return false }
            exitInsert()
            return true
        }
        if isEscape {
            resetPending()
            if mode.isVisual { exitVisual() } else { setCursor(textView.selectedRange().location) }
            return true
        }
        if control { return handleControl(key) }
        if let mapped = Self.arrowKeys[key] { return handle(mapped) }
        // Home, End, Page Up/Down and similar keep their usual behaviour.
        if let scalar = key.unicodeScalars.first, (0xF700...0xF8FF).contains(scalar.value) { return false }

        let startedInNormal = mode == .normal
        if !isReplaying, startedInNormal { keys.append(key) }
        didChange = false
        process(key)

        if !isReplaying {
            if mode == .insert {
                if startedInNormal, insertChange == nil {
                    insertChange = (keys, textView.selectedRange().location, didChange)
                }
                keys = []
            } else if isIdle {
                if startedInNormal, didChange, key != "." { lastChange = Change(keys: keys, inserted: nil) }
                keys = []
            }
        }
        return true
    }

    func handle(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.command) { return false }
        let control = flags.contains(.control)
        var key = (control ? event.charactersIgnoringModifiers : event.characters) ?? ""
        // Dead keys (^ ` ´ on Spanish layouts) report no characters; outside insert mode
        // they must act as the key itself rather than start composing an accent.
        if key.isEmpty, mode != .insert { key = event.charactersIgnoringModifiers ?? "" }
        guard !key.isEmpty else { return mode != .insert }
        return handle(key, control: control)
    }

    func reset() {
        resetPending()
        mode = .normal
        setCursor(textView.selectedRange().location)
    }

    private static let arrowKeys: [String: String] = [
        String(UnicodeScalar(NSLeftArrowFunctionKey)!): "h",
        String(UnicodeScalar(NSRightArrowFunctionKey)!): "l",
        String(UnicodeScalar(NSUpArrowFunctionKey)!): "k",
        String(UnicodeScalar(NSDownArrowFunctionKey)!): "j",
    ]

    private var isIdle: Bool { count == nil && pendingOperator == nil && pendingPrefix == nil }

    private func resetPending() {
        count = nil
        operatorCount = nil
        pendingOperator = nil
        pendingPrefix = nil
    }

    // MARK: - Normal and visual mode

    private func process(_ key: String) {
        if let prefix = pendingPrefix {
            pendingPrefix = nil
            handlePrefix(prefix, key)
            return
        }
        if let digit = Int(key), digit > 0 || count != nil {
            count = (count ?? 0) * 10 + digit
            return
        }

        let hasCount = count != nil || operatorCount != nil
        let n = (count ?? 1) * (operatorCount ?? 1)
        count = nil

        if let op = pendingOperator {
            if key == op.rawValue {
                operatorCount = nil
                pendingOperator = nil
                applyLinewise(op, lines: n)
                return
            }
            switch key {
            case "i", "a":
                pendingPrefix = .textObject(inner: key == "i")
                count = hasCount ? n : nil
                return
            case "g", "f", "F", "t", "T":
                pendingPrefix = key == "g" ? .g : .find(key)
                count = hasCount ? n : nil
                return
            default:
                operatorCount = nil
                pendingOperator = nil
                if let target = motion(key, count: n, hasCount: hasCount, forOperator: op) {
                    apply(op, to: target)
                } else {
                    NSSound.beep()
                }
                return
            }
        }

        if mode.isVisual, handleVisualCommand(key, count: n) { return }

        if let op = Operator(rawValue: key), !mode.isVisual {
            pendingOperator = op
            operatorCount = hasCount ? n : nil
            return
        }

        switch key {
        case "g", "f", "F", "t", "T", "r":
            pendingPrefix = key == "g" ? .g : key == "r" ? .replace : .find(key)
            count = hasCount ? n : nil
            return
        case "i", "a":
            if mode.isVisual {
                pendingPrefix = .textObject(inner: key == "i")
                return
            }
        default:
            break
        }

        if let target = motion(key, count: n, hasCount: hasCount, forOperator: nil) {
            move(to: target.location, keepColumn: target.kind == .linewise && "jk".contains(key))
            return
        }
        guard mode == .normal else { return NSSound.beep() }
        normalCommand(key, count: n, hasCount: hasCount)
    }

    private func normalCommand(_ key: String, count n: Int, hasCount: Bool) {
        let c = cursor
        let line = lineBounds(c)
        desiredColumn = nil
        switch key {
        case "i": enterInsert(at: c)
        case "a": enterInsert(at: min(c + 1, line.contentsEnd))
        case "I": enterInsert(at: firstNonBlank(line.start))
        case "A": enterInsert(at: line.contentsEnd)
        case "o":
            let indent = indentation(of: line.start)
            replace(NSRange(location: line.contentsEnd, length: 0), with: "\n" + indent)
            enterInsert(at: line.contentsEnd + 1 + (indent as NSString).length)
        case "O":
            let indent = indentation(of: line.start)
            replace(NSRange(location: line.start, length: 0), with: indent + "\n")
            enterInsert(at: line.start + (indent as NSString).length)
        case "x": apply(.delete, to: Target(location: min(c + n, line.contentsEnd), kind: .exclusive))
        case "X": apply(.delete, to: Target(location: max(line.start, c - n), kind: .exclusive))
        case "D": apply(.delete, to: endOfLineTarget(lines: n))
        case "C": apply(.change, to: endOfLineTarget(lines: n))
        case "s": apply(.change, to: Target(location: min(c + n, line.contentsEnd), kind: .exclusive))
        case "S": applyLinewise(.change, lines: n)
        case "Y": applyLinewise(.yank, lines: n)
        case "p", "P": paste(after: key == "p", count: n)
        case "J": joinLines(count: max(2, n))
        case "~": toggleCase(NSRange(location: c, length: min(n, line.contentsEnd - c)), advance: true)
        case "u": repeatAction(n) { textView.undoManager?.undo() }
        case ".": repeatLastChange(count: n)
        case "v", "V":
            anchor = c
            head = c
            mode = key == "v" ? .visual : .visualLine
            updateVisualSelection()
        case ":": mode = .command("")
        case "/", "?": findAction(.showFindInterface)
        case "n": findAction(.nextMatch)
        case "N": findAction(.previousMatch)
        default: NSSound.beep()
        }
    }

    private func handlePrefix(_ prefix: Prefix, _ key: String) {
        let hasCount = count != nil || operatorCount != nil
        let n = (count ?? 1) * (operatorCount ?? 1)
        count = nil
        let op = pendingOperator
        operatorCount = nil
        pendingOperator = nil

        switch prefix {
        case .g:
            guard key == "g" else { return NSSound.beep() }
            let target = Target(location: firstNonBlank(lineStart(ofLine: hasCount ? n - 1 : 0)), kind: .linewise)
            if let op { apply(op, to: target) } else { move(to: target.location) }
        case .find(let kind):
            lastFind = (kind, key)
            guard let target = findTarget(kind: kind, character: key, count: n) else { return NSSound.beep() }
            if let op { apply(op, to: target) } else { move(to: target.location) }
        case .replace:
            let c = cursor
            let line = lineBounds(c)
            guard c + n <= line.contentsEnd, key != Self.escape else { return NSSound.beep() }
            replace(NSRange(location: c, length: n), with: String(repeating: key, count: n))
            setCursor(c + n - 1)
        case .textObject(let inner):
            guard let range = textObject(key, inner: inner) else { return NSSound.beep() }
            if let op {
                apply(op, range: range, linewise: false)
            } else if mode.isVisual {
                if mode == .visualLine { mode = .visual }
                anchor = range.location
                head = max(range.location, NSMaxRange(range) - 1)
                updateVisualSelection()
            }
        }
    }

    private func handleControl(_ key: String) -> Bool {
        switch key {
        case "r":
            repeatAction(count ?? 1) { textView.undoManager?.redo() }
            count = nil
        case "d", "u":
            let lines = max(1, visibleLineCount() / 2)
            let target = verticalTarget(key == "d" ? lines : -lines)
            move(to: target)
            textView.scrollRangeToVisible(NSRange(location: target, length: 0))
        default:
            return false
        }
        return true
    }

    private func repeatAction(_ n: Int, _ action: () -> Void) {
        for _ in 0..<n { action() }
        if mode == .normal { setCursor(textView.selectedRange().location) }
    }

    // MARK: - Visual mode

    private func handleVisualCommand(_ key: String, count n: Int) -> Bool {
        let range = visualRange
        let linewise = mode == .visualLine
        switch key {
        case "d", "x", "X", "D":
            apply(.delete, range: range, linewise: linewise)
        case "c", "s", "S", "C":
            apply(.change, range: range, linewise: linewise)
        case "y", "Y":
            apply(.yank, range: range, linewise: linewise)
        case ">", "<":
            apply(key == ">" ? .indent : .outdent, range: range, linewise: true)
        case "~":
            toggleCase(range, advance: false)
            exitVisual(to: range.location)
        case "J":
            let lines = lineIndex(of: NSMaxRange(range) - 1) - lineIndex(of: range.location) + 1
            exitVisual(to: range.location)
            joinLines(count: max(2, lines))
        case "p", "P":
            let pasted = currentRegister()
            apply(.delete, range: range, linewise: linewise)
            insertRegister(pasted, after: false, count: 1)
        case "o":
            swap(&anchor, &head)
            updateVisualSelection()
        case "v", "V":
            let target: VimMode = key == "v" ? .visual : .visualLine
            if mode == target { exitVisual() } else {
                mode = target
                updateVisualSelection()
            }
        default:
            return false
        }
        return true
    }

    private var visualRange: NSRange {
        let start = min(anchor, head)
        let end = max(anchor, head)
        if mode == .visualLine {
            let first = lineBounds(start).start
            let last = lineBounds(end).end
            return NSRange(location: first, length: last - first)
        }
        return NSRange(location: start, length: min(end + 1, length) - start)
    }

    private func updateVisualSelection() {
        textView.setSelectedRange(visualRange)
        textView.scrollRangeToVisible(NSRange(location: head, length: 0))
    }

    private func exitVisual(to location: Int? = nil) {
        let target = location ?? head
        mode = .normal
        setCursor(target)
    }

    // MARK: - Insert mode

    private func enterInsert(at location: Int) {
        textView.setSelectedRange(NSRange(location: location, length: 0))
        mode = .insert
    }

    private func exitInsert() {
        if !isReplaying, let pending = insertChange {
            let end = textView.selectedRange().location
            let inserted = end >= pending.start ? text.substring(with: NSRange(location: pending.start, length: end - pending.start)) : ""
            if pending.changed || !inserted.isEmpty {
                lastChange = Change(keys: pending.keys, inserted: inserted)
            }
        }
        insertChange = nil
        textView.breakUndoCoalescing()
        mode = .normal
        let c = textView.selectedRange().location
        setCursor(c > lineBounds(c).start ? c - 1 : c)
    }

    private func repeatLastChange(count n: Int) {
        guard let change = lastChange else { return NSSound.beep() }
        isReplaying = true
        defer { isReplaying = false }
        for _ in 0..<n {
            for key in change.keys { _ = handle(key) }
            if mode == .insert {
                if let inserted = change.inserted, !inserted.isEmpty {
                    textView.insertText(inserted, replacementRange: textView.selectedRange())
                }
                _ = handle(Self.escape)
            }
        }
        didChange = true
    }

    // MARK: - Command line

    private func handleCommandLine(_ key: String, line: String) {
        switch key {
        case Self.escape:
            mode = .normal
        case "\r", "\n":
            mode = .normal
            execute(line.trimmingCharacters(in: .whitespaces))
        case "\u{7f}", "\u{8}":
            mode = line.isEmpty ? .normal : .command(String(line.dropLast()))
        default:
            mode = .command(line + key)
        }
    }

    private func execute(_ command: String) {
        if let line = Int(command) {
            move(to: firstNonBlank(lineStart(ofLine: max(0, line - 1))))
            return
        }
        let save = { NSApp.sendAction(#selector(NSDocument.save(_:)), to: nil, from: self.textView) }
        let close = { [weak window = textView.window] in window?.performClose(nil) }
        switch command {
        case "w", "write": _ = save()
        case "q", "quit", "q!": close()
        case "wq", "x", "exit":
            _ = save()
            DispatchQueue.main.async { close() }
        default: NSSound.beep()
        }
    }

    private func findAction(_ action: NSTextFinder.Action) {
        let item = NSMenuItem()
        item.tag = action.rawValue
        textView.performFindPanelAction(item)
    }

    // MARK: - Motions

    private func motion(_ key: String, count n: Int, hasCount: Bool, forOperator op: Operator?) -> Target? {
        let c = cursor
        let line = lineBounds(c)
        switch key {
        case "h", "\u{7f}":
            return Target(location: max(line.start, c - n), kind: .exclusive)
        case "l", " ":
            return Target(location: min(line.contentsEnd, c + n), kind: .exclusive)
        case "j", "k", "+", "-", "\r":
            let down = key == "j" || key == "+" || key == "\r"
            let target = verticalTarget(down ? n : -n)
            let location = "jk".contains(key) ? target : firstNonBlank(lineBounds(target).start)
            return Target(location: location, kind: .linewise)
        case "0":
            return Target(location: line.start, kind: .exclusive)
        case "^", "_":
            return Target(location: firstNonBlank(line.start), kind: .exclusive)
        case "$":
            return endOfLineTarget(lines: n)
        case "G":
            let lastLine = lineIndex(of: length)
            return Target(location: firstNonBlank(lineStart(ofLine: hasCount ? n - 1 : lastLine)), kind: .linewise)
        case "w", "W":
            if op == .change, !isSpace(c) {
                return Target(location: wordEnd(from: c, count: n, big: key == "W", allowCurrent: true), kind: .inclusive)
            }
            var target = c
            for _ in 0..<n { target = nextWordStart(from: target, big: key == "W") }
            // An operator never swallows the line break after the last word.
            if op != nil, target > line.contentsEnd, lineIndex(of: target) > lineIndex(of: c) {
                target = max(line.contentsEnd, c)
            }
            return Target(location: target, kind: .exclusive)
        case "e", "E":
            return Target(location: wordEnd(from: c, count: n, big: key == "E", allowCurrent: false), kind: .inclusive)
        case "b", "B":
            var target = c
            for _ in 0..<n { target = previousWordStart(from: target, big: key == "B") }
            return Target(location: target, kind: .exclusive)
        case "}", "{":
            var target = c
            for _ in 0..<n { target = paragraphBoundary(from: target, forward: key == "}") }
            return Target(location: target, kind: .exclusive)
        case "%":
            guard let match = matchingBracket(from: c) else { return nil }
            return Target(location: match, kind: .inclusive)
        case ";", ",":
            guard let last = lastFind else { return nil }
            let kind = key == ";" ? last.kind : Self.reversedFind[last.kind] ?? last.kind
            return findTarget(kind: kind, character: last.character, count: n, repeating: true)
        default:
            return nil
        }
    }

    private static let reversedFind = ["f": "F", "F": "f", "t": "T", "T": "t"]

    private func endOfLineTarget(lines n: Int) -> Target {
        let target = line(lineBounds(cursor), offsetBy: n - 1)
        return Target(location: max(target.start, target.contentsEnd - 1), kind: .inclusive)
    }

    private func verticalTarget(_ delta: Int) -> Int {
        let c = cursor
        let current = lineBounds(c)
        let column = desiredColumn ?? (c - current.start)
        desiredColumn = column
        let target = line(current, offsetBy: delta)
        return min(target.start + column, max(target.start, target.contentsEnd - 1))
    }

    private func findTarget(kind: String, character: String, count n: Int, repeating: Bool = false) -> Target? {
        let c = cursor
        let line = lineBounds(c)
        let needle = character as NSString
        guard needle.length > 0 else { return nil }
        let forward = kind == "f" || kind == "t"
        var position = c
        for index in 0..<n {
            // Repeating `t`/`T` must not stick on the character right next to the cursor.
            let skip = repeating && (kind == "t" || kind == "T") && index == 0 ? 1 : 0
            let searchRange = forward
                ? NSRange(location: position + 1 + skip, length: max(0, line.contentsEnd - position - 1 - skip))
                : NSRange(location: line.start, length: max(0, position - skip - line.start))
            guard searchRange.length > 0 else { return nil }
            let found = text.range(of: character, options: forward ? [] : .backwards, range: searchRange)
            guard found.location != NSNotFound else { return nil }
            position = found.location
        }
        switch kind {
        case "f": return Target(location: position, kind: .inclusive)
        case "t": return Target(location: position - 1, kind: .inclusive)
        case "F": return Target(location: position, kind: .exclusive)
        default: return Target(location: position + 1, kind: .exclusive)
        }
    }

    // MARK: - Words, paragraphs and brackets

    private enum CharClass { case space, word, punctuation }

    private func charClass(_ index: Int, big: Bool) -> CharClass {
        let unit = text.character(at: index)
        guard let scalar = UnicodeScalar(unit) else { return .word }
        if CharacterSet.whitespacesAndNewlines.contains(scalar) { return .space }
        if big || scalar == "_" || CharacterSet.alphanumerics.contains(scalar) { return .word }
        return .punctuation
    }

    private func isSpace(_ index: Int) -> Bool {
        index < length && charClass(index, big: true) == .space
    }

    private func isNewline(_ index: Int) -> Bool {
        index >= 0 && index < length && text.character(at: index) == 10
    }

    private func nextWordStart(from start: Int, big: Bool) -> Int {
        var i = start
        guard i < length else { return length }
        let current = charClass(i, big: big)
        if current != .space {
            while i < length, charClass(i, big: big) == current { i += 1 }
        }
        while i < length, charClass(i, big: big) == .space {
            // An empty line counts as a word of its own.
            if isNewline(i), isNewline(i + 1), i + 1 != start { return i + 1 }
            i += 1
        }
        return i
    }

    private func wordEnd(from start: Int, count n: Int, big: Bool, allowCurrent: Bool) -> Int {
        guard length > 0 else { return 0 }
        var i = start
        for index in 0..<n {
            // `cw` ends the current word instead of jumping to the next one.
            if !(allowCurrent && index == 0) {
                i += 1
                while i < length, charClass(i, big: big) == .space { i += 1 }
            }
            guard i < length else { return length - 1 }
            let current = charClass(i, big: big)
            while i + 1 < length, charClass(i + 1, big: big) == current { i += 1 }
        }
        return i
    }

    private func previousWordStart(from start: Int, big: Bool) -> Int {
        var i = start - 1
        while i > 0, charClass(i, big: big) == .space {
            if isNewline(i), isNewline(i - 1) { return i }
            i -= 1
        }
        guard i > 0 else { return 0 }
        let current = charClass(i, big: big)
        while i > 0, charClass(i - 1, big: big) == current { i -= 1 }
        return i
    }

    private func paragraphBoundary(from start: Int, forward: Bool) -> Int {
        var line = lineBounds(start)
        let step = forward ? nextLine : previousLine
        // Skip the blank lines we are on, then stop at the next one.
        while isBlank(line), let next = step(line) { line = next }
        while let next = step(line) {
            line = next
            if isBlank(line) { return line.start }
        }
        return forward ? length : 0
    }

    private static let bracketPairs: [Character: (Character, Bool)] = [
        "(": (")", true), "[": ("]", true), "{": ("}", true),
        ")": ("(", false), "]": ("[", false), "}": ("{", false),
    ]

    private func matchingBracket(from start: Int) -> Int? {
        let line = lineBounds(start)
        var i = start
        while i < line.contentsEnd {
            if let character = character(at: i), Self.bracketPairs[character] != nil { break }
            i += 1
        }
        guard i < line.contentsEnd, let open = character(at: i), let (close, forward) = Self.bracketPairs[open] else {
            return nil
        }
        var depth = 0
        var j = i
        while j >= 0, j < length {
            let current = character(at: j)
            if current == open { depth += 1 } else if current == close { depth -= 1 }
            if depth == 0 { return j }
            j += forward ? 1 : -1
        }
        return nil
    }

    private func textObject(_ key: String, inner: Bool) -> NSRange? {
        switch key {
        case "w", "W": return wordObject(inner: inner, big: key == "W")
        case "\"", "'", "`": return quoteObject(Character(key), inner: inner)
        case "(", ")", "b": return bracketObject(open: "(", close: ")", inner: inner)
        case "[", "]": return bracketObject(open: "[", close: "]", inner: inner)
        case "{", "}", "B": return bracketObject(open: "{", close: "}", inner: inner)
        case "<", ">": return bracketObject(open: "<", close: ">", inner: inner)
        case "p": return paragraphObject(inner: inner)
        default: return nil
        }
    }

    private func wordObject(inner: Bool, big: Bool) -> NSRange? {
        let c = cursor
        let line = lineBounds(c)
        guard c < line.contentsEnd else { return nil }
        let current = charClass(c, big: big)
        var start = c
        var end = c + 1
        while start > line.start, charClass(start - 1, big: big) == current { start -= 1 }
        while end < line.contentsEnd, charClass(end, big: big) == current { end += 1 }
        if !inner, current != .space {
            let wordEnd = end
            while end < line.contentsEnd, charClass(end, big: big) == .space { end += 1 }
            if end == wordEnd {
                while start > line.start, charClass(start - 1, big: big) == .space { start -= 1 }
            }
        }
        return NSRange(location: start, length: end - start)
    }

    private func quoteObject(_ quote: Character, inner: Bool) -> NSRange? {
        let c = cursor
        let line = lineBounds(c)
        var positions: [Int] = []
        for i in line.start..<line.contentsEnd where character(at: i) == quote { positions.append(i) }
        var index = 0
        while index + 1 < positions.count {
            let open = positions[index]
            let close = positions[index + 1]
            if c <= close {
                return inner
                    ? NSRange(location: open + 1, length: close - open - 1)
                    : NSRange(location: open, length: close - open + 1)
            }
            index += 2
        }
        return nil
    }

    private func bracketObject(open: Character, close: Character, inner: Bool) -> NSRange? {
        let c = cursor
        var depth = 0
        var start = character(at: c) == close ? c - 1 : c
        var openIndex: Int?
        while start >= 0 {
            let current = character(at: start)
            if current == close { depth += 1 }
            if current == open {
                if depth == 0 { openIndex = start; break }
                depth -= 1
            }
            start -= 1
        }
        guard let openIndex else { return nil }
        depth = 0
        var end = openIndex
        while end < length {
            let current = character(at: end)
            if current == open { depth += 1 }
            if current == close {
                depth -= 1
                if depth == 0 { break }
            }
            end += 1
        }
        guard end < length else { return nil }
        return inner
            ? NSRange(location: openIndex + 1, length: end - openIndex - 1)
            : NSRange(location: openIndex, length: end - openIndex + 1)
    }

    private func paragraphObject(inner: Bool) -> NSRange? {
        var first = lineBounds(cursor)
        var last = first
        let blank = isBlank(first)
        while let previous = previousLine(first), isBlank(previous) == blank { first = previous }
        while let next = nextLine(last), isBlank(next) == blank { last = next }
        if !inner {
            while let next = nextLine(last), isBlank(next) != blank { last = next }
        }
        return NSRange(location: first.start, length: last.end - first.start)
    }

    // MARK: - Operators

    private func apply(_ op: Operator, to target: Target) {
        let c = cursor
        if target.kind == .linewise {
            let first = lineBounds(min(c, target.location)).start
            let last = lineBounds(max(c, target.location)).end
            apply(op, range: NSRange(location: first, length: last - first), linewise: true)
            return
        }
        var start = min(c, target.location)
        var end = max(c, target.location)
        if target.kind == .inclusive { end = min(length, end + 1) }
        start = max(0, start)
        guard end > start || op == .change else {
            if op != .yank { NSSound.beep() }
            return
        }
        apply(op, range: NSRange(location: start, length: end - start), linewise: false)
    }

    private func applyLinewise(_ op: Operator, lines n: Int) {
        let first = lineBounds(cursor)
        let last = line(first, offsetBy: n - 1)
        apply(op, range: NSRange(location: first.start, length: last.end - first.start), linewise: true)
    }

    private func apply(_ op: Operator, range: NSRange, linewise: Bool) {
        let wasVisual = mode.isVisual
        if wasVisual { mode = .normal }
        desiredColumn = nil
        let content = text.substring(with: range)

        switch op {
        case .yank:
            store(content, linewise: linewise)
            setCursor(linewise && !wasVisual ? cursor : range.location)
        case .delete:
            store(content, linewise: linewise)
            if linewise {
                var removal = range
                // The last line has no trailing newline: take the one before it instead.
                if NSMaxRange(range) == length, !content.hasSuffix("\n"), range.location > 0 {
                    removal = NSRange(location: range.location - 1, length: range.length + 1)
                }
                replace(removal, with: "")
                setCursor(firstNonBlank(lineBounds(min(removal.location, length)).start))
            } else {
                replace(range, with: "")
                setCursor(range.location)
            }
        case .change:
            store(content, linewise: linewise)
            if linewise {
                let bounds = lineBounds(range.location)
                let lastLine = lineBounds(max(range.location, NSMaxRange(range) - 1))
                let indent = indentation(of: bounds.start)
                replace(NSRange(location: bounds.start, length: lastLine.contentsEnd - bounds.start), with: indent)
                enterInsert(at: bounds.start + (indent as NSString).length)
            } else {
                replace(range, with: "")
                enterInsert(at: range.location)
            }
        case .indent, .outdent:
            shiftLines(in: range, outdent: op == .outdent)
        }
    }

    private func shiftLines(in range: NSRange, outdent: Bool) {
        var lines = [lineBounds(range.location)]
        while let next = nextLine(lines[lines.count - 1]), next.start < NSMaxRange(range) { lines.append(next) }
        // Bottom-up, so earlier offsets stay valid while editing.
        for bounds in lines.reversed() {
            let start = bounds.start
            guard bounds.contentsEnd > bounds.start else { continue }
            if outdent {
                var remove = 0
                while remove < 4, start + remove < bounds.contentsEnd, character(at: start + remove) == " " { remove += 1 }
                if remove == 0, character(at: start) == "\t" { remove = 1 }
                if remove > 0 { replace(NSRange(location: start, length: remove), with: "") }
            } else {
                replace(NSRange(location: start, length: 0), with: Self.indentUnit)
            }
        }
        setCursor(firstNonBlank(lines[0].start))
    }

    private func joinLines(count n: Int) {
        let c = cursor
        var joinPoint = c
        for _ in 0..<(n - 1) {
            let line = lineBounds(c)
            guard line.contentsEnd < length else { break }
            var next = line.end
            while next < length, !isNewline(next), charClass(next, big: true) == .space { next += 1 }
            let endsInSpace = line.contentsEnd > line.start && isSpace(line.contentsEnd - 1)
            let needsSpace = line.contentsEnd > line.start && !endsInSpace
                && next < length && !isNewline(next) && character(at: next) != ")"
            replace(NSRange(location: line.contentsEnd, length: next - line.contentsEnd), with: needsSpace ? " " : "")
            joinPoint = line.contentsEnd
        }
        setCursor(joinPoint)
    }

    private func toggleCase(_ range: NSRange, advance: Bool) {
        guard range.length > 0 else { return NSSound.beep() }
        let original = text.substring(with: range)
        let toggled = String(original.map { character -> String in
            let string = String(character)
            return string == string.uppercased() ? string.lowercased() : string.uppercased()
        }.joined())
        replace(range, with: toggled)
        setCursor(advance ? NSMaxRange(range) : range.location)
    }

    // MARK: - Registers

    private func store(_ content: String, linewise: Bool) {
        let stored = linewise && !content.hasSuffix("\n") ? content + "\n" : content
        register = (stored, linewise)
        pasteboard?.clearContents()
        pasteboard?.setString(stored, forType: .string)
    }

    /// The system clipboard wins when something else was copied after the last yank.
    private func currentRegister() -> (text: String, linewise: Bool) {
        if let external = pasteboard?.string(forType: .string), external != register.text {
            return (external, external.hasSuffix("\n"))
        }
        return register
    }

    private func paste(after: Bool, count n: Int) {
        insertRegister(currentRegister(), after: after, count: n)
    }

    private func insertRegister(_ content: (text: String, linewise: Bool), after: Bool, count n: Int) {
        guard !content.text.isEmpty else { return NSSound.beep() }
        let repeated = String(repeating: content.text, count: n)
        let c = cursor
        let line = lineBounds(c)
        if content.linewise {
            if after {
                if line.end == line.contentsEnd {
                    // Last line without a trailing newline.
                    replace(NSRange(location: length, length: 0), with: "\n" + String(repeated.dropLast()))
                    setCursor(firstNonBlank(line.contentsEnd + 1))
                } else {
                    replace(NSRange(location: line.end, length: 0), with: repeated)
                    setCursor(firstNonBlank(line.end))
                }
            } else {
                replace(NSRange(location: line.start, length: 0), with: repeated)
                setCursor(firstNonBlank(line.start))
            }
        } else {
            let location = after && c < line.contentsEnd ? c + 1 : c
            replace(NSRange(location: location, length: 0), with: repeated)
            setCursor(location + (repeated as NSString).length - 1)
        }
    }

    // MARK: - Text helpers

    private var text: NSString { textView.string as NSString }
    private var length: Int { text.length }

    private var cursor: Int {
        mode.isVisual ? head : min(textView.selectedRange().location, length)
    }

    private func character(at index: Int) -> Character? {
        guard index >= 0, index < length else { return nil }
        return Character(text.substring(with: text.rangeOfComposedCharacterSequence(at: index)))
    }

    private typealias Line = (start: Int, end: Int, contentsEnd: Int)

    private func lineBounds(_ location: Int) -> Line {
        var start = 0
        var end = 0
        var contentsEnd = 0
        text.getLineStart(&start, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: min(location, length), length: 0))
        return (start, end, contentsEnd)
    }

    private func nextLine(_ line: Line) -> Line? {
        line.end < length ? lineBounds(line.end) : nil
    }

    private func previousLine(_ line: Line) -> Line? {
        line.start > 0 ? lineBounds(line.start - 1) : nil
    }

    /// The line `offset` lines away, stopping at the first or last line.
    private func line(_ line: Line, offsetBy offset: Int) -> Line {
        var current = line
        for _ in 0..<abs(offset) {
            guard let next = offset > 0 ? nextLine(current) : previousLine(current) else { break }
            current = next
        }
        return current
    }

    private func isBlank(_ line: Line) -> Bool {
        text.substring(with: NSRange(location: line.start, length: line.contentsEnd - line.start))
            .trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func lineIndex(of location: Int) -> Int {
        var count = 0
        let limit = min(location, length)
        var search = 0
        while search < limit {
            let found = text.range(of: "\n", range: NSRange(location: search, length: limit - search))
            guard found.location != NSNotFound else { break }
            count += 1
            search = found.location + 1
        }
        return count
    }

    private func lineStart(ofLine index: Int) -> Int {
        var start = 0
        for _ in 0..<max(0, index) {
            let found = text.range(of: "\n", range: NSRange(location: start, length: length - start))
            guard found.location != NSNotFound else { break }
            start = found.location + 1
        }
        return start
    }

    private func firstNonBlank(_ lineStart: Int) -> Int {
        let line = lineBounds(lineStart)
        var i = line.start
        while i < line.contentsEnd, charClass(i, big: true) == .space { i += 1 }
        return min(i, max(line.start, line.contentsEnd - 1))
    }

    private func indentation(of lineStart: Int) -> String {
        let line = lineBounds(lineStart)
        var i = line.start
        while i < line.contentsEnd, charClass(i, big: true) == .space { i += 1 }
        return text.substring(with: NSRange(location: line.start, length: i - line.start))
    }

    private func visibleLineCount() -> Int {
        guard let font = textView.font, let layoutManager = textView.layoutManager else { return 20 }
        return Int(textView.visibleRect.height / max(1, layoutManager.defaultLineHeight(for: font)))
    }

    private func replace(_ range: NSRange, with string: String) {
        guard textView.shouldChangeText(in: range, replacementString: string) else { return }
        textView.textStorage?.replaceCharacters(in: range, with: string)
        textView.didChangeText()
        didChange = true
    }

    private func move(to location: Int, keepColumn: Bool = false) {
        if !keepColumn { desiredColumn = nil }
        if mode.isVisual {
            head = max(0, min(location, max(0, length - 1)))
            updateVisualSelection()
        } else {
            setCursor(location)
        }
    }

    /// Normal mode never rests on a line break, except on an empty line.
    private func setCursor(_ location: Int) {
        let clamped = max(0, min(location, length))
        let line = lineBounds(clamped)
        let target = mode == .insert ? clamped : min(clamped, max(line.start, line.contentsEnd - 1))
        head = target
        textView.setSelectedRange(NSRange(location: target, length: 0))
        textView.scrollRangeToVisible(NSRange(location: target, length: 0))
    }
}

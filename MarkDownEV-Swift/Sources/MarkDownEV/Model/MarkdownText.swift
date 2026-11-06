import Foundation

struct OutlineHeading: Identifiable, Hashable {
    let level: Int
    let title: String
    /// Zero-based source line, matching the `data-line` attributes in the preview.
    let line: Int

    var id: Int { line }
}

struct TextStats: Equatable {
    let words: Int
    let characters: Int

    var readingMinutes: Int { max(1, Int((Double(words) / 220).rounded(.up))) }
}

enum MarkdownText {
    static func outline(of text: String) -> [OutlineHeading] {
        var headings: [OutlineHeading] = []
        var fence: Substring?
        var lineNumber = 0

        text.enumerateLines { rawLine, _ in
            defer { lineNumber += 1 }
            let line = rawLine.drop(while: { $0 == " " })
            if let marker = fenceMarker(line) {
                if fence == nil {
                    fence = marker
                } else if let open = fence, line.hasPrefix(open) {
                    fence = nil
                }
                return
            }
            guard fence == nil, rawLine.count - line.count < 4, line.first == "#" else { return }

            let hashes = line.prefix(while: { $0 == "#" })
            guard hashes.count <= 6 else { return }
            let rest = line.dropFirst(hashes.count)
            guard rest.isEmpty || rest.first == " " || rest.first == "\t" else { return }

            var title = rest.trimmingCharacters(in: .whitespaces)
            while title.hasSuffix("#") {
                title.removeLast()
            }
            title = title.trimmingCharacters(in: .whitespaces)
            guard !title.isEmpty else { return }
            headings.append(OutlineHeading(level: hashes.count, title: title, line: lineNumber))
        }
        return headings
    }

    /// The section being read: the last heading at or above `line`
    /// (the first heading while the reader is still above it).
    static func activeHeading(in headings: [OutlineHeading], atLine line: Int) -> OutlineHeading? {
        headings.last { $0.line <= line } ?? headings.first
    }

    static func stats(of text: String) -> TextStats {
        var words = 0
        var inWord = false
        for scalar in text.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                if !inWord { words += 1 }
                inWord = true
            } else if scalar != "'" && scalar != "’" && scalar != "-" {
                inWord = false
            }
        }
        return TextStats(words: words, characters: text.count)
    }

    /// Returns the UTF-16 range of the task marker character (` `, `x` or `X`) on `line`.
    static func taskMarkerRange(in text: NSString, line: Int) -> NSRange? {
        guard let lineRange = lineRange(in: text, line: line) else { return nil }
        let pattern = #"^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text as String, range: lineRange)
        else { return nil }
        return match.range(at: 1)
    }

    static func lineRange(in text: NSString, line: Int) -> NSRange? {
        guard line >= 0 else { return nil }
        var start = 0
        var current = 0
        while current < line {
            let next = text.range(of: "\n", range: NSRange(location: start, length: text.length - start))
            guard next.location != NSNotFound else { return nil }
            start = next.location + 1
            current += 1
        }
        guard start <= text.length else { return nil }
        let end = text.range(of: "\n", range: NSRange(location: start, length: text.length - start))
        let length = (end.location == NSNotFound ? text.length : end.location) - start
        return NSRange(location: start, length: length)
    }

    private static func fenceMarker(_ line: Substring) -> Substring? {
        for marker in ["```", "~~~"] where line.hasPrefix(marker) {
            return line.prefix(while: { $0 == marker.first })
        }
        return nil
    }
}

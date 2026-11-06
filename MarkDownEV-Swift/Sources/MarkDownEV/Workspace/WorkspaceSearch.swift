import Foundation

struct SearchMatch: Identifiable, Hashable, Sendable {
    let line: Int
    let preview: String
    /// Range of the match inside `preview`.
    let highlight: Range<String.Index>

    var id: Int { line }
}

struct SearchFileResult: Identifiable, Hashable, Sendable {
    let url: URL
    let relativePath: String
    let matches: [SearchMatch]

    var id: URL { url }
}

enum WorkspaceSearch {
    static let maxResults = 500
    static let maxMatchesPerFile = 100
    static let maxFileSize = 5 * 1024 * 1024
    private static let previewRadius = 70
    private static let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    static func run(_ query: String, in root: URL) throws -> [SearchFileResult] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return [] }

        var results: [SearchFileResult] = []
        var total = 0
        for url in WorkspaceFiles.allDocuments(in: root) {
            try Task.checkCancellation()
            guard total < maxResults else { break }

            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= maxFileSize,
                  let data = try? Data(contentsOf: url),
                  let text = try? MarkdownDocument.decode(data)
            else { continue }

            let matches = search(needle, in: text, limit: min(maxMatchesPerFile, maxResults - total))
            guard !matches.isEmpty else { continue }
            total += matches.count
            results.append(SearchFileResult(url: url, relativePath: relativePath(of: url, in: root), matches: matches))
        }
        return results
    }

    static func search(_ needle: String, in text: String, limit: Int) -> [SearchMatch] {
        var matches: [SearchMatch] = []
        var lineNumber = 0
        text.enumerateLines { line, stop in
            defer { lineNumber += 1 }
            if let range = line.range(of: needle, options: options) {
                matches.append(makeMatch(line: lineNumber, text: line, range: range))
                if matches.count >= limit { stop = true }
            }
        }
        return matches
    }

    private static func makeMatch(line: Int, text: String, range: Range<String.Index>) -> SearchMatch {
        let start = text.index(range.lowerBound, offsetBy: -previewRadius, limitedBy: text.startIndex) ?? text.startIndex
        let end = text.index(range.upperBound, offsetBy: previewRadius, limitedBy: text.endIndex) ?? text.endIndex

        let leading = text[start..<range.lowerBound].drop(while: \.isWhitespace)
        let prefix = (start > text.startIndex ? "…" : "") + leading
        let matched = String(text[range])
        let suffix = String(text[range.upperBound..<end]) + (end < text.endIndex ? "…" : "")

        let preview = prefix + matched + suffix
        let lower = preview.index(preview.startIndex, offsetBy: prefix.count)
        let upper = preview.index(lower, offsetBy: matched.count)
        return SearchMatch(line: line, preview: preview, highlight: lower..<upper)
    }

    private static func relativePath(of url: URL, in root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(rootPath + "/") else { return url.lastPathComponent }
        return String(path.dropFirst(rootPath.count + 1))
    }
}

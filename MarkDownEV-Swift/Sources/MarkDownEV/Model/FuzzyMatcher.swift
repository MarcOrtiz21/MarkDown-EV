import Foundation

/// Subsequence matcher for the command palette: "ntsrec" finds "Notas/Receta.md".
/// Rewards consecutive characters and matches at word starts.
enum FuzzyMatcher {
    static func score(_ query: String, in candidate: String) -> Int? {
        let needle = normalize(query).filter { !$0.isWhitespace }
        guard !needle.isEmpty else { return 0 }
        let haystack = Array(normalize(candidate))

        var score = 0
        var needleIndex = needle.startIndex
        var previousMatch: Int?

        for (index, character) in haystack.enumerated() where needleIndex < needle.endIndex {
            guard character == needle[needleIndex] else { continue }
            score += 1
            if let previousMatch, previousMatch == index - 1 {
                score += 5
            }
            if index == 0 || isWordBoundary(haystack[index - 1]) {
                score += 8
            }
            if let previousMatch {
                score -= min(index - previousMatch - 1, 3)
            }
            previousMatch = index
            needleIndex = needle.index(after: needleIndex)
        }

        guard needleIndex == needle.endIndex else { return nil }
        // Prefer shorter candidates when everything else is equal.
        return score * 100 - haystack.count
    }

    private static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    private static func isWordBoundary(_ character: Character) -> Bool {
        character == " " || character == "/" || character == "-" || character == "_" || character == "."
    }
}

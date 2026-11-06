import SwiftUI

struct SearchResultsView: View {
    let query: String
    let root: URL?
    let onOpen: (URL, SearchMatch) -> Void

    @State private var results: [SearchFileResult] = []
    @State private var isSearching = false

    private struct SearchKey: Equatable {
        let query: String
        let root: URL?
    }

    var body: some View {
        List {
            if !results.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(results) { file in
                Section {
                    ForEach(file.matches) { match in
                        Button { onOpen(file.url, match) } label: {
                            MatchRow(match: match)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Label(file.relativePath, systemImage: "doc.text")
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(file.relativePath)
                }
            }
        }
        .listStyle(.sidebar)
        .overlay {
            if results.isEmpty {
                if isSearching {
                    ProgressView()
                } else if root == nil {
                    ContentUnavailableView("Sin carpeta", systemImage: "folder", description: Text("Abre una carpeta para buscar en ella."))
                } else {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
        .task(id: SearchKey(query: query, root: root)) {
            await search()
        }
    }

    private var summary: String {
        let matches = results.reduce(0) { $0 + $1.matches.count }
        let limited = matches >= WorkspaceSearch.maxResults ? " (límite alcanzado)" : ""
        return "\(matches) resultados en \(results.count) archivos\(limited)"
    }

    private func search() async {
        guard let root else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let query = query
            let found = try await Task.detached(priority: .userInitiated) {
                try WorkspaceSearch.run(query, in: root)
            }.value
            try Task.checkCancellation()
            results = found
        } catch {
            // Cancelled because the query changed; the next task replaces the results.
        }
    }
}

private struct MatchRow: View {
    let match: SearchMatch

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(String(match.line + 1))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
                .frame(minWidth: 24, alignment: .trailing)
            Text(highlighted)
                .font(.callout)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var highlighted: AttributedString {
        let preview = match.preview
        var hit = AttributedString(preview[match.highlight])
        hit.font = .callout.bold()
        hit.foregroundColor = .accentColor
        return AttributedString(preview[..<match.highlight.lowerBound])
            + hit
            + AttributedString(preview[match.highlight.upperBound...])
    }
}

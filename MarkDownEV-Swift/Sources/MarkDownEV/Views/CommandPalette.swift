import SwiftUI

struct PaletteItem: Identifiable {
    let id: String
    let title: String
    var subtitle: String?
    let systemImage: String
    var shortcut: String?
    let action: @MainActor () -> Void

    var matchText: String {
        subtitle.map { "\($0)/\(title)" } ?? title
    }
}

enum PaletteMode {
    case commands
    case files
    case headings

    var placeholder: String {
        switch self {
        case .commands: "Escribe un comando o el nombre de una nota…"
        case .files: "Abrir nota…"
        case .headings: "Ir a encabezado…"
        }
    }
}

struct CommandPalette: View {
    let mode: PaletteMode
    let commands: [PaletteItem]
    let files: [PaletteItem]
    let headings: [PaletteItem]
    let isLoadingFiles: Bool
    let onDismiss: () -> Void

    @State private var query = ""
    @State private var selectedIndex = 0
    @FocusState private var isFocused: Bool

    private var results: [PaletteItem] {
        if query.hasPrefix("#") { return rank(headings, String(query.dropFirst())) }
        if query.hasPrefix(">") { return rank(commands, String(query.dropFirst())) }
        switch mode {
        case .files: return rank(files, query)
        case .headings: return rank(headings, query)
        case .commands: return query.isEmpty ? commands : rank(commands + files, query)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField(mode.placeholder, text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isFocused)
                    .onSubmit { run(results.indices.contains(selectedIndex) ? results[selectedIndex] : nil) }
                    .onKeyPress(.upArrow) { move(-1); return .handled }
                    .onKeyPress(.downArrow) { move(1); return .handled }
                    .onKeyPress(.escape) { onDismiss(); return .handled }
                if isLoadingFiles {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)

            let items = results
            if !items.isEmpty {
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                                PaletteRow(item: item, isSelected: index == selectedIndex)
                                    .id(item.id)
                                    .onTapGesture { run(item) }
                                    .onHover { if $0 { selectedIndex = index } }
                            }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 360)
                    .onChange(of: selectedIndex) { _, index in
                        if items.indices.contains(index) { proxy.scrollTo(items[index].id) }
                    }
                }
            } else if !query.isEmpty {
                Divider()
                Text("Sin resultados")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
            }
        }
        .frame(width: 580)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
        .onAppear { isFocused = true }
        .onChange(of: query) { selectedIndex = 0 }
        .accessibilityAddTraits(.isModal)
    }

    private func rank(_ items: [PaletteItem], _ query: String) -> [PaletteItem] {
        let query = query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return Array(items.prefix(200)) }
        return items
            .compactMap { item in FuzzyMatcher.score(query, in: item.matchText).map { (item, $0) } }
            .sorted { $0.1 > $1.1 }
            .prefix(100)
            .map(\.0)
    }

    private func move(_ delta: Int) {
        let count = results.count
        guard count > 0 else { return }
        selectedIndex = (selectedIndex + delta + count) % count
    }

    private func run(_ item: PaletteItem?) {
        guard let item else { return }
        onDismiss()
        item.action()
    }
}

private struct PaletteRow: View {
    let item: PaletteItem
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: item.systemImage)
                .frame(width: 20)
                .foregroundStyle(isSelected ? .primary : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .lineLimit(1)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 12)
            if let shortcut = item.shortcut {
                Text(shortcut)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.accentColor.opacity(0.2))
            }
        }
        .contentShape(Rectangle())
    }
}

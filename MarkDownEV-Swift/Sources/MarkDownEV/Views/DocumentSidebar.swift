import SwiftUI

enum SidebarTab: String, CaseIterable, Identifiable {
    case files
    case outline

    var id: Self { self }

    var title: String {
        switch self {
        case .files: "Archivos"
        case .outline: "Índice"
        }
    }

    var systemImage: String {
        switch self {
        case .files: "folder"
        case .outline: "list.bullet.indent"
        }
    }
}

struct DocumentSidebar: View {
    @Binding var tab: SidebarTab
    let searchQuery: String
    let workspace: WorkspaceModel
    let currentFile: URL?
    let headings: [OutlineHeading]
    let readingPosition: ReadingPosition
    let onSelectHeading: (OutlineHeading) -> Void
    let onOpenSearchResult: (URL, SearchMatch) -> Void
    let onChooseFolder: () -> Void

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Group {
            if isSearching {
                SearchResultsView(query: searchQuery, root: workspace.root, onOpen: onOpenSearchResult)
            } else {
                switch tab {
                case .files:
                    FileTreeView(workspace: workspace, currentFile: currentFile, onChooseFolder: onChooseFolder)
                case .outline:
                    OutlineSidebar(headings: headings, position: readingPosition, onSelect: onSelectHeading)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !isSearching {
                Picker("Panel lateral", selection: $tab) {
                    ForEach(SidebarTab.allCases) { tab in
                        Label(tab.title, systemImage: tab.systemImage).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }
        }
        .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 380)
    }
}

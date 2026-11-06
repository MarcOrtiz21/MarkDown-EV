import AppKit
import SwiftUI

struct DocumentView: View {
    @ObservedObject var document: MarkdownDocument
    let fileURL: URL?

    @SceneStorage("viewMode") private var viewMode: ViewMode = .split
    @SceneStorage("splitRatio") private var splitRatio = 0.5
    @SceneStorage("sidebarTab") private var sidebarTab: SidebarTab = .files
    /// Folder chosen explicitly by the user; empty means "the document's folder".
    @SceneStorage("workspaceRoot") private var chosenRoot = ""
    @State private var editor = EditorController()
    @State private var preview = PreviewController()
    @State private var workspace = WorkspaceModel()
    @State private var readingPosition = ReadingPosition()
    @State private var actions = WindowActions()
    @State private var columnVisibility = NavigationSplitViewVisibility.automatic
    @State private var searchQuery = ""
    @FocusState private var isSearchFocused: Bool
    @State private var paletteMode: PaletteMode?
    @State private var paletteFiles: [URL] = []
    @State private var isLoadingPaletteFiles = false
    @Environment(\.openSettings) private var openSettings

    @AppStorage(SettingsKey.editorFont) private var editorFont: EditorFontStyle = .monospaced
    @AppStorage(SettingsKey.editorFontSize) private var editorFontSize = 14.0
    @AppStorage(SettingsKey.editorLineSpacing) private var editorLineSpacing = 1.25
    @AppStorage(SettingsKey.readableWidth) private var readableWidth = 780.0
    @AppStorage(SettingsKey.spellCheck) private var spellCheck = true
    @AppStorage(SettingsKey.vimMode) private var vimEnabled = false
    @State private var vimMode: VimMode?
    @AppStorage(SettingsKey.previewFont) private var previewFont: PreviewFontStyle = .system
    @AppStorage(SettingsKey.previewFontSize) private var previewFontSize = 16.0
    @AppStorage(SettingsKey.syncScroll) private var syncScroll = true

    private var editorSettings: EditorSettings {
        EditorSettings(
            font: editorFont,
            fontSize: editorFontSize,
            lineSpacing: editorLineSpacing,
            readableWidth: readableWidth,
            spellCheck: spellCheck,
            vimMode: vimEnabled
        )
    }

    private var previewSettings: PreviewSettings {
        PreviewSettings(font: previewFont, fontSize: previewFontSize)
    }

    private var syncsScroll: Bool { viewMode == .split && syncScroll }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            DocumentSidebar(
                tab: $sidebarTab,
                searchQuery: searchQuery,
                workspace: workspace,
                currentFile: fileURL,
                headings: MarkdownText.outline(of: document.text),
                readingPosition: readingPosition,
                onSelectHeading: { navigate(to: $0.line) },
                onOpenSearchResult: openSearchResult,
                onChooseFolder: { actions.openFolder() }
            )
        } detail: {
            panes
                .overlay(alignment: .bottomTrailing) {
                    StatsBadge(stats: MarkdownText.stats(of: document.text), vimMode: viewMode.showsEditor ? vimMode : nil)
                        .padding(14)
                }
                .ignoresSafeArea(edges: .bottom)
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Vista", selection: $viewMode) {
                    ForEach(ViewMode.allCases) { mode in
                        Label(mode.title, systemImage: mode.systemImage)
                            .help("\(mode.title) (⌘\(String(mode.shortcut.character)))")
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelStyle(.iconOnly)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Imprimir o exportar PDF", systemImage: "printer") {
                    preview.printDocument()
                }
                .help("Imprimir o exportar PDF (⌘P)")
            }
        }
        .overlay(alignment: .top) {
            if let paletteMode {
                ZStack(alignment: .top) {
                    Color.black.opacity(0.001)
                        .onTapGesture { closePalette() }
                    CommandPalette(
                        mode: paletteMode,
                        commands: PaletteCatalog.commands(actions: actions, fileURL: fileURL) { openSettings() },
                        files: PaletteCatalog.files(paletteFiles, root: workspace.root),
                        headings: PaletteCatalog.headings(MarkdownText.outline(of: document.text)) { navigate(to: $0) },
                        isLoadingFiles: isLoadingPaletteFiles,
                        onDismiss: closePalette
                    )
                    .id(paletteMode)
                    .padding(.top, 70)
                }
            }
        }
        .searchable(text: $searchQuery, placement: .sidebar, prompt: "Buscar en la carpeta")
        .searchFocused($isSearchFocused)
        .focusedSceneValue(\.viewMode, $viewMode)
        .focusedSceneValue(\.windowActions, actions)
        .onChange(of: viewMode, initial: true) { _, mode in
            if mode.showsEditor { editor.focus() }
        }
        .onChange(of: syncsScroll, initial: true) { _, enabled in
            editor.onTopLineChange = enabled ? { [preview] line in preview.scrollTo(line: line) } : nil
        }
        .onChange(of: fileURL, initial: true) { _, _ in updateWorkspaceRoot() }
        .onAppear {
            configureActions()
            applyPendingNavigation()
        }
        .onReceive(NotificationCenter.default.publisher(for: DocumentNavigator.didRequestNavigation)) { notification in
            if (notification.object as? URL) == fileURL?.standardizedFileURL {
                applyPendingNavigation()
            }
        }
        .background(WindowConfigurator { window in
            // Documents opened from Finder, links or the sidebar join this window as tabs.
            window.tabbingMode = .preferred
        })
        .frame(minWidth: 620, minHeight: 400)
    }

    private func updateWorkspaceRoot() {
        if !chosenRoot.isEmpty, FileManager.default.fileExists(atPath: chosenRoot) {
            workspace.setRoot(URL(fileURLWithPath: chosenRoot, isDirectory: true))
        } else {
            workspace.setRoot(fileURL?.deletingLastPathComponent())
        }
    }

    private func configureActions() {
        editor.onVisibleLineChange = { [readingPosition] line in readingPosition.update(line) }
        let vimMode = $vimMode
        editor.onVimModeChange = { vimMode.wrappedValue = $0 }
        let chosenRoot = $chosenRoot
        let sidebarTab = $sidebarTab
        let columnVisibility = $columnVisibility
        let isSearchFocused = $isSearchFocused
        actions.openFolder = { [workspace] in
            if let url = workspace.chooseRoot() {
                chosenRoot.wrappedValue = url.path
                sidebarTab.wrappedValue = .files
                columnVisibility.wrappedValue = .all
            }
        }
        actions.searchInFolder = {
            columnVisibility.wrappedValue = .all
            isSearchFocused.wrappedValue = true
        }
        actions.showSidebarTab = { tab in
            sidebarTab.wrappedValue = tab
            columnVisibility.wrappedValue = .all
        }
        actions.printDocument = { [preview] in preview.printDocument() }
        actions.exportHTML = { [preview, fileURL] in
            Task {
                await DocumentExport.saveHTML(
                    from: preview,
                    title: Self.title(for: fileURL),
                    suggestedDirectory: fileURL?.deletingLastPathComponent()
                )
            }
        }
        actions.copyRichText = { [preview, document, fileURL] in
            Task {
                await DocumentExport.copyRichText(from: preview, markdown: document.text, title: Self.title(for: fileURL))
            }
        }
        actions.newNoteInFolder = { [workspace] in
            guard let root = workspace.root else {
                NSDocumentController.shared.newDocument(nil)
                return
            }
            if let url = workspace.createNote(in: root) { DocumentNavigator.open(url) }
        }
        let viewMode = $viewMode
        actions.setViewMode = { viewMode.wrappedValue = $0 }
        actions.toggleSidebar = {
            columnVisibility.wrappedValue = columnVisibility.wrappedValue == .detailOnly ? .all : .detailOnly
        }
        let paletteMode = $paletteMode
        actions.showPalette = { [self] mode in
            paletteMode.wrappedValue = mode
            if mode != .headings { loadPaletteFiles() }
        }
    }

    private static func title(for fileURL: URL?) -> String {
        fileURL?.deletingPathExtension().lastPathComponent ?? "Sin título"
    }

    private func loadPaletteFiles() {
        guard let root = workspace.root else {
            paletteFiles = []
            return
        }
        isLoadingPaletteFiles = true
        Task {
            let files = await Task.detached(priority: .userInitiated) {
                Array(WorkspaceFiles.allDocuments(in: root).prefix(5000))
            }.value
            paletteFiles = files
            isLoadingPaletteFiles = false
        }
    }

    private func closePalette() {
        paletteMode = nil
        if viewMode.showsEditor { editor.focus() }
    }

    private func openSearchResult(_ url: URL, _ match: SearchMatch) {
        let target = NavigationTarget(line: match.line, highlight: searchQuery.trimmingCharacters(in: .whitespaces))
        if url.standardizedFileURL == fileURL?.standardizedFileURL {
            reveal(target)
        } else {
            DocumentNavigator.open(url, at: target)
        }
    }

    private func applyPendingNavigation() {
        guard let target = DocumentNavigator.takePendingTarget(for: fileURL) else { return }
        // A freshly opened window needs a moment for the editor to lay out and the preview to render.
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            reveal(target)
        }
    }

    private func reveal(_ target: NavigationTarget) {
        if viewMode.showsEditor { editor.reveal(line: target.line, highlighting: target.highlight) }
        if viewMode.showsPreview { preview.scrollTo(line: target.line) }
    }

    private var panes: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let minPane = min(260, width * 0.3)
            let editorWidth: CGFloat = switch viewMode {
            case .editor: width
            case .preview: 0
            case .split: min(max(width * splitRatio, minPane), width - minPane)
            }

            HStack(spacing: 0) {
                MarkdownEditor(document: document, controller: editor, settings: editorSettings, fileURL: fileURL)
                    .frame(width: editorWidth)
                    .opacity(viewMode.showsEditor ? 1 : 0)
                    .allowsHitTesting(viewMode.showsEditor)

                if viewMode == .split {
                    SplitHandle(ratio: $splitRatio, totalWidth: width)
                }

                MarkdownPreview(
                    text: document.text,
                    fileURL: fileURL,
                    controller: preview,
                    settings: previewSettings,
                    onEvent: handle
                )
                    .frame(maxWidth: .infinity)
                    .opacity(viewMode.showsPreview ? 1 : 0)
                    .allowsHitTesting(viewMode.showsPreview)
            }
        }
    }

    private func navigate(to line: Int) {
        readingPosition.update(line)
        if viewMode.showsEditor { editor.scrollTo(line: line, select: true) }
        if viewMode.showsPreview { preview.scrollTo(line: line) }
    }

    private func handle(_ event: PreviewEvent) {
        switch event {
        case .scrolled(let line):
            readingPosition.update(line)
            if syncsScroll { editor.scrollTo(line: line) }
        case .taskToggled(let line, let checked):
            editor.setTask(line: line, checked: checked)
        case .linkActivated(let href):
            LinkRouter.open(href, relativeTo: fileURL)
        case .wikiLinkActivated(let target):
            LinkRouter.openWikiLink(target, relativeTo: fileURL, workspaceRoot: workspace.root)
        }
    }
}

private struct StatsBadge: View {
    let stats: TextStats
    let vimMode: VimMode?

    var body: some View {
        HStack(spacing: 8) {
            if let vimMode {
                Text(vimMode.label)
                    .font(.caption.weight(.semibold).monospaced())
                    .foregroundStyle(vimMode == .normal ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                    .contentTransition(.identity)
                    .accessibilityLabel("Modo Vim: \(vimMode.label)")
                Divider().frame(height: 11)
            }
            Text("\(stats.words.formatted()) palabras · \(stats.readingMinutes) min")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(stats.words) palabras, \(stats.readingMinutes) minutos de lectura")
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .capsule)
    }
}

private struct SplitHandle: View {
    @Binding var ratio: Double
    let totalWidth: CGFloat
    @State private var dragStartRatio: Double?

    var body: some View {
        Rectangle()
            .fill(.separator)
            .frame(width: 1)
            .padding(.horizontal, 3)
            .contentShape(Rectangle())
            .pointerStyle(.columnResize)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStartRatio ?? ratio
                        dragStartRatio = start
                        ratio = min(0.8, max(0.2, start + value.translation.width / max(totalWidth, 1)))
                    }
                    .onEnded { _ in dragStartRatio = nil }
            )
            .onTapGesture(count: 2) { ratio = 0.5 }
            .accessibilityLabel("Divisor entre editor y vista previa")
    }
}

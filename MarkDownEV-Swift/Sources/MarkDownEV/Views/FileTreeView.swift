import AppKit
import SwiftUI

struct FileTreeView: View {
    let workspace: WorkspaceModel
    let currentFile: URL?
    let onChooseFolder: () -> Void

    @State private var selection: URL?
    @State private var renameTarget: FileItem?
    @State private var renameText = ""

    var body: some View {
        if let root = workspace.root {
            List(selection: $selection) {
                Section {
                    FileTreeLevel(directory: root, workspace: workspace, onRename: beginRename)
                } header: {
                    Text(root.lastPathComponent)
                        .contextMenu { rootMenu(root) }
                }
            }
            .listStyle(.sidebar)
            .contextMenu { rootMenu(root) }
            .onAppear { selection = currentFile?.standardizedFileURL }
            .onChange(of: currentFile) { _, url in selection = url?.standardizedFileURL }
            .onChange(of: selection) { _, url in activate(url) }
            .alert("Renombrar", isPresented: isRenaming) {
                TextField("Nombre", text: $renameText)
                Button("Renombrar") {
                    if let renameTarget { workspace.rename(renameTarget, to: renameText) }
                }
                Button("Cancelar", role: .cancel) {}
            }
        } else {
            ContentUnavailableView {
                Label("Sin carpeta", systemImage: "folder")
            } description: {
                Text("Abre una carpeta para navegar por sus notas.")
            } actions: {
                Button("Abrir carpeta…", action: onChooseFolder)
            }
        }
    }

    private var isRenaming: Binding<Bool> {
        Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })
    }

    private func beginRename(_ item: FileItem) {
        renameText = item.name
        renameTarget = item
    }

    private func activate(_ url: URL?) {
        let current = currentFile?.standardizedFileURL
        guard let url, url != current else { return }
        if WorkspaceFiles.isDocument(url) {
            DocumentNavigator.open(url)
        } else if workspace.expanded.remove(url) == nil {
            workspace.expanded.insert(url)
        }
        // This window keeps showing its own document; the click opened another tab.
        selection = current
    }

    @ViewBuilder
    private func rootMenu(_ root: URL) -> some View {
        Button("Nueva nota") { createNote(in: root) }
        Button("Cambiar carpeta…", action: onChooseFolder)
        Button("Mostrar en Finder") { NSWorkspace.shared.activateFileViewerSelecting([root]) }
        Divider()
        Button("Actualizar") { workspace.refresh() }
    }

    private func createNote(in directory: URL) {
        if let url = workspace.createNote(in: directory) {
            DocumentNavigator.open(url)
        }
    }
}

private struct FileTreeLevel: View {
    let directory: URL
    let workspace: WorkspaceModel
    let onRename: (FileItem) -> Void

    var body: some View {
        if let items = workspace.children[directory] {
            ForEach(items) { item in
                if item.isDirectory {
                    DisclosureGroup(isExpanded: expansion(of: item.url)) {
                        FileTreeLevel(directory: item.url, workspace: workspace, onRename: onRename)
                    } label: {
                        Label(item.name, systemImage: "folder")
                            .contextMenu { menu(for: item) }
                    }
                    .tag(item.url)
                } else {
                    Label(item.url.deletingPathExtension().lastPathComponent, systemImage: "doc.text")
                        .help(item.name)
                        .tag(item.url)
                        .contextMenu { menu(for: item) }
                }
            }
        } else {
            Text("Cargando…")
                .foregroundStyle(.secondary)
                .onAppear { workspace.load(directory) }
        }
    }

    private func expansion(of url: URL) -> Binding<Bool> {
        Binding(
            get: { workspace.expanded.contains(url) },
            set: { isExpanded in
                if isExpanded {
                    workspace.expanded.insert(url)
                } else {
                    workspace.expanded.remove(url)
                }
            }
        )
    }

    @ViewBuilder
    private func menu(for item: FileItem) -> some View {
        if item.isDirectory {
            Button("Nueva nota aquí") {
                if let url = workspace.createNote(in: item.url) { DocumentNavigator.open(url) }
            }
        } else {
            Button("Abrir") { DocumentNavigator.open(item.url) }
        }
        Button("Mostrar en Finder") { NSWorkspace.shared.activateFileViewerSelecting([item.url]) }
        Divider()
        Button("Renombrar…") { onRename(item) }
        Button("Mover a la papelera", role: .destructive) { workspace.moveToTrash(item) }
    }
}

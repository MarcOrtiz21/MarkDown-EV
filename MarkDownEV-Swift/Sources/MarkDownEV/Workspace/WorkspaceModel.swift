import AppKit
import Observation

/// Per-window folder state: the root being browsed and the lazily loaded tree.
@MainActor
@Observable
final class WorkspaceModel {
    private(set) var root: URL?
    private(set) var children: [URL: [FileItem]] = [:]
    var expanded: Set<URL> = []

    @ObservationIgnored private var watcher: DirectoryWatcher?
    @ObservationIgnored private var loading: Set<URL> = []

    func setRoot(_ url: URL?) {
        let url = url?.standardizedFileURL
        guard url != root else { return }
        root = url
        children = [:]
        expanded = []
        watcher = url.map { root in
            DirectoryWatcher(url: root) { [weak self] _ in
                Task { @MainActor in self?.refresh() }
            }
        }
        if let url { load(url) }
    }

    func chooseRoot() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Abrir carpeta"
        panel.directoryURL = root
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        setRoot(url)
        return url
    }

    func load(_ directory: URL) {
        guard !loading.contains(directory) else { return }
        loading.insert(directory)
        Task {
            // Listing runs off the main thread: protected folders block until the
            // user answers the privacy prompt.
            let items = await Task.detached(priority: .userInitiated) { WorkspaceFiles.list(directory) }.value
            loading.remove(directory)
            if children[directory] != items {
                children[directory] = items
            }
        }
    }

    func refresh() {
        for directory in children.keys {
            load(directory)
        }
    }

    // MARK: - File operations

    @discardableResult
    func createNote(in directory: URL) -> URL? {
        let url = WorkspaceFiles.availableURL(in: directory)
        do {
            try Data().write(to: url, options: .withoutOverwriting)
            expanded.insert(directory)
            load(directory)
            return url
        } catch {
            NSApp.presentError(error)
            return nil
        }
    }

    func rename(_ item: FileItem, to newName: String) {
        var name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.contains("/"), name != item.name else { return }
        if !item.isDirectory, (name as NSString).pathExtension.isEmpty {
            name += "." + item.url.pathExtension
        }
        let destination = item.url.deletingLastPathComponent().appending(path: name)
        do {
            try FileManager.default.moveItem(at: item.url, to: destination)
            if expanded.remove(item.url) != nil { expanded.insert(destination) }
            load(item.url.deletingLastPathComponent())
        } catch {
            NSApp.presentError(error)
        }
    }

    func moveToTrash(_ item: FileItem) {
        do {
            try FileManager.default.trashItem(at: item.url, resultingItemURL: nil)
            load(item.url.deletingLastPathComponent())
        } catch {
            NSApp.presentError(error)
        }
    }
}

import Foundation

struct FileItem: Identifiable, Hashable, Sendable {
    let url: URL
    let isDirectory: Bool

    var id: URL { url }
    var name: String { url.lastPathComponent }
}

enum WorkspaceFiles {
    static let documentExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"]
    static let ignoredDirectories: Set<String> = ["node_modules", ".build", "DerivedData", "Pods"]

    static func isDocument(_ url: URL) -> Bool {
        documentExtensions.contains(url.pathExtension.lowercased())
    }

    /// Markdown documents and visible sub-folders, folders first, in Finder order.
    static func list(_ directory: URL) -> [FileItem] {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey, .isPackageKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        )) ?? []

        return contents.compactMap { url -> FileItem? in
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey])
            let isDirectory = values?.isDirectory == true && values?.isPackage != true
            if isDirectory {
                return ignoredDirectories.contains(url.lastPathComponent) ? nil : FileItem(url: url, isDirectory: true)
            }
            return isDocument(url) ? FileItem(url: url, isDirectory: false) : nil
        }
        .sorted { lhs, rhs in
            if lhs.isDirectory != rhs.isDirectory { return lhs.isDirectory }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    /// Every document below `root`, depth first, skipping hidden and ignored folders.
    static func allDocuments(in root: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }

        var documents: [URL] = []
        for case let url as URL in enumerator {
            if ignoredDirectories.contains(url.lastPathComponent) {
                enumerator.skipDescendants()
            } else if isDocument(url) {
                documents.append(url)
            }
        }
        return documents
    }

    /// `Sin título.md`, `Sin título 2.md`, … — the first name not taken in `directory`.
    static func availableURL(in directory: URL, baseName: String = "Sin título", extension ext: String = "md") -> URL {
        var candidate = directory.appending(path: "\(baseName).\(ext)")
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directory.appending(path: "\(baseName) \(counter).\(ext)")
            counter += 1
        }
        return candidate
    }

    /// Finds the note a `[[wiki link]]` points at, preferring the linking document's folder.
    static func resolveWikiLink(_ name: String, near folder: URL?, in root: URL?) -> URL? {
        let fileName = isDocument(URL(fileURLWithPath: name)) ? name : "\(name).md"
        if let folder {
            let local = folder.appending(path: fileName)
            if FileManager.default.fileExists(atPath: local.path) { return local }
        }
        guard let root else { return nil }
        let target = (fileName as NSString).lastPathComponent.lowercased()
        return allDocuments(in: root).first { $0.lastPathComponent.lowercased() == target }
    }
}

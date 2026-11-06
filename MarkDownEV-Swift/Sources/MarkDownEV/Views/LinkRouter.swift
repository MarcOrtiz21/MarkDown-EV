import AppKit

@MainActor
enum LinkRouter {
    private static let webSchemes: Set<String> = ["http", "https", "mailto"]

    static func open(_ href: String, relativeTo documentURL: URL?) {
        if let url = URL(string: href), let scheme = url.scheme?.lowercased() {
            // Anything that is not a web link (file:, javascript:, custom schemes) is ignored on purpose.
            if webSchemes.contains(scheme) {
                NSWorkspace.shared.open(url)
            }
            return
        }

        let pathPart = href.split(separator: "#", maxSplits: 1).first.map(String.init) ?? href
        let path = pathPart.removingPercentEncoding ?? pathPart
        guard !path.isEmpty else { return }

        let target: URL
        if path.hasPrefix("/") {
            target = URL(fileURLWithPath: path)
        } else if let base = documentURL?.deletingLastPathComponent() {
            target = base.appending(path: path)
        } else {
            NSSound.beep()
            return
        }
        openLocalFile(target.standardizedFileURL)
    }

    static func openWikiLink(_ name: String, relativeTo documentURL: URL?, workspaceRoot: URL?) {
        guard !name.isEmpty else { return }
        let folder = documentURL?.deletingLastPathComponent()
        Task {
            let match = await Task.detached(priority: .userInitiated) {
                WorkspaceFiles.resolveWikiLink(name, near: folder, in: workspaceRoot)
            }.value
            if let match {
                openLocalFile(match)
            } else {
                NSSound.beep()
            }
        }
    }

    private static func openLocalFile(_ url: URL) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            NSSound.beep()
            return
        }
        if !isDirectory.boolValue, WorkspaceFiles.isDocument(url) {
            DocumentNavigator.open(url)
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }
}

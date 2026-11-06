import AppKit

struct NavigationTarget: Equatable {
    let line: Int
    let highlight: String?
}

/// Opens documents and hands a "go to line" request to the window that shows them,
/// whether that window already exists or is about to be created.
@MainActor
enum DocumentNavigator {
    static let didRequestNavigation = Notification.Name("MarkDownEV.didRequestNavigation")

    private static var pending: [URL: NavigationTarget] = [:]

    static func open(_ url: URL, at target: NavigationTarget? = nil) {
        let url = url.standardizedFileURL
        if let target { pending[url] = target }
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, alreadyOpen, error in
            Task { @MainActor in
                if let error {
                    pending[url] = nil
                    NSApp.presentError(error)
                } else if alreadyOpen {
                    NotificationCenter.default.post(name: didRequestNavigation, object: url)
                }
            }
        }
    }

    static func takePendingTarget(for url: URL?) -> NavigationTarget? {
        guard let url else { return nil }
        return pending.removeValue(forKey: url.standardizedFileURL)
    }
}

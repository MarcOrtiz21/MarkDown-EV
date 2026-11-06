import Foundation
import OSLog
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled preview page (`mdev://app/…`) and local images referenced
/// by documents (`app-image://local/<encoded absolute path>`).
@MainActor
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    static let appScheme = "mdev"
    static let imageScheme = "app-image"
    static let pageURL = URL(string: "mdev://app/index.html")!

    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic", "tif", "tiff"]
    private static let log = Logger(subsystem: "com.marcortiz.markdown-ev", category: "preview")

    private let previewRoot: URL? = Bundle.main.resourceURL?
        .appendingPathComponent("Preview", isDirectory: true)
        .standardizedFileURL

    /// Tasks WebKit has not stopped yet. Responding to a stopped task raises an exception.
    private var activeTasks: [ObjectIdentifier: any WKURLSchemeTask] = [:]

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let fileURL = resolve(url) else {
            Self.log.error("Refused resource: \(task.request.url?.absoluteString ?? "nil", privacy: .public)")
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let id = ObjectIdentifier(task)
        activeTasks[id] = task
        // File reads stay off the main thread: opening a file in a protected folder
        // (Documents, Desktop…) blocks until the user answers the privacy prompt.
        Task.detached(priority: .userInitiated) { [weak self] in
            let result = Result { try Data(contentsOf: fileURL, options: .mappedIfSafe) }
            await self?.finish(id, url: url, fileURL: fileURL, result: result)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        activeTasks[ObjectIdentifier(task)] = nil
    }

    private func finish(_ id: ObjectIdentifier, url: URL, fileURL: URL, result: Result<Data, any Error>) {
        guard let task = activeTasks.removeValue(forKey: id) else { return }
        switch result {
        case .success(let data):
            let mimeType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mimeType,
                    "Content-Length": String(data.count),
                    "Cache-Control": "no-cache",
                    // Vite emits `<script type="module" crossorigin>`, which WebKit
                    // fetches in CORS mode even from our own scheme.
                    "Access-Control-Allow-Origin": "*",
                ]
            )!
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        case .failure(let error):
            Self.log.error("Could not read \(fileURL.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            task.didFailWithError(error)
        }
    }

    private func resolve(_ url: URL) -> URL? {
        switch url.scheme {
        case Self.appScheme:
            guard let previewRoot, url.host == "app" else { return nil }
            let file = previewRoot.appendingPathComponent(url.path).standardizedFileURL
            return file.path.hasPrefix(previewRoot.path + "/") ? file : nil

        case Self.imageScheme:
            let prefix = "app-image://local/"
            let raw = url.absoluteString
            guard raw.hasPrefix(prefix),
                  let path = String(raw.dropFirst(prefix.count)).removingPercentEncoding
            else { return nil }
            let file = URL(fileURLWithPath: path).standardizedFileURL
            guard Self.imageExtensions.contains(file.pathExtension.lowercased()) else { return nil }
            return file

        default:
            return nil
        }
    }
}

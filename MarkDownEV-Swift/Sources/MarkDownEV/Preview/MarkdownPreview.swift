import AppKit
import OSLog
import SwiftUI
import WebKit

private let previewLog = Logger(subsystem: "com.marcortiz.markdown-ev", category: "preview")

enum PreviewEvent {
    case scrolled(line: Int)
    case taskToggled(line: Int, checked: Bool)
    case linkActivated(String)
    case wikiLinkActivated(String)
}

@MainActor
final class PreviewController {
    fileprivate weak var webView: WKWebView?

    func scrollTo(line: Int) {
        webView?.callAsyncJavaScript(
            "window.mdev?.scrollToLine(line)",
            arguments: ["line": line],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    var window: NSWindow? { webView?.window }

    func exportHTML(title: String) async -> String? {
        guard let webView else { return nil }
        return await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript(
                "return window.mdev.exportHTML(title)",
                arguments: ["title": title],
                in: nil,
                in: .page
            ) { result in
                continuation.resume(returning: try? result.get() as? String)
            }
        }
    }

    func printDocument() {
        guard let webView, let window = webView.window else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.topMargin = 36
        info.bottomMargin = 36
        let operation = webView.printOperation(with: info)
        // WebKit prints blank pages unless the print view has a non-empty frame,
        // which is not the case while the preview pane is hidden.
        let pageWidth = info.paperSize.width - info.leftMargin - info.rightMargin
        let width = webView.bounds.width > 0 ? webView.bounds.width : pageWidth
        operation.view?.frame = NSRect(x: 0, y: 0, width: width, height: max(webView.bounds.height, 600))
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }
}

struct MarkdownPreview: NSViewRepresentable {
    let text: String
    let fileURL: URL?
    let controller: PreviewController
    let settings: PreviewSettings
    let onEvent: (PreviewEvent) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let schemeHandler = LocalSchemeHandler()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: LocalSchemeHandler.appScheme)
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: LocalSchemeHandler.imageScheme)
        configuration.userContentController.add(WeakMessageHandler(context.coordinator), name: "mdev")
        configuration.userContentController.addUserScript(Self.errorReporter)
        configuration.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = true
        webView.underPageBackgroundColor = .textBackgroundColor
        webView.setAccessibilityLabel("Vista previa")
        webView.load(URLRequest(url: LocalSchemeHandler.pageURL))

        context.coordinator.webView = webView
        controller.webView = webView
        context.coordinator.observeAccentColor()
        return webView
    }

    /// Runs before the page's own scripts (and outside its CSP) so that module
    /// loading failures are reported to the host instead of failing silently.
    private static let errorReporter = WKUserScript(
        source: """
        (() => {
          const report = (message) => window.webkit?.messageHandlers?.mdev?.postMessage({ type: 'error', message: String(message) })
          window.addEventListener('error', (event) => {
            const source = event.target?.src || event.target?.href
            report(source ? `No se pudo cargar ${source}` : `${event.message} (${event.filename}:${event.lineno})`)
          }, true)
          window.addEventListener('unhandledrejection', (event) => report(event.reason?.stack || event.reason))
        })()
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        controller.webView = webView
        context.coordinator.applyStyleIfNeeded()
        context.coordinator.scheduleRender()
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "mdev")
        coordinator.renderTask?.cancel()
        NotificationCenter.default.removeObserver(coordinator)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: MarkdownPreview
        weak var webView: WKWebView?
        var renderTask: Task<Void, Never>?
        private var isReady = false
        private var renderedText: String?
        private var renderedPath: String?

        init(parent: MarkdownPreview) {
            self.parent = parent
        }

        func observeAccentColor() {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(systemColorsDidChange),
                name: NSColor.systemColorsDidChangeNotification,
                object: nil
            )
        }

        @objc private func systemColorsDidChange() {
            applyAccentColor()
        }

        func scheduleRender() {
            guard isReady else { return }
            let path = parent.fileURL?.path ?? ""
            guard parent.text != renderedText || path != renderedPath else { return }

            renderTask?.cancel()
            // Render the first frame immediately; debounce subsequent keystrokes.
            let delay: Duration = renderedText == nil ? .zero : .milliseconds(120)
            renderTask = Task { [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                self?.render()
            }
        }

        private func render() {
            guard let webView else { return }
            let text = parent.text
            let path = parent.fileURL?.path ?? ""
            renderedText = text
            renderedPath = path
            webView.callAsyncJavaScript(
                "return window.mdev.render(markdown, filePath)",
                arguments: ["markdown": text, "filePath": path],
                in: nil,
                in: .page
            ) { result in
                switch result {
                case .success(let value):
                    previewLog.debug("Rendered \(String(describing: value), privacy: .public)")
                case .failure(let error):
                    previewLog.error("Render failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }

        private var appliedSettings: PreviewSettings?

        func applyStyleIfNeeded() {
            guard isReady, let webView, appliedSettings != parent.settings else { return }
            let settings = parent.settings
            appliedSettings = settings
            webView.callAsyncJavaScript(
                "window.mdev.setStyle({ font, fontSize })",
                arguments: ["font": settings.font.rawValue, "fontSize": settings.fontSize],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }

        private func applyAccentColor() {
            guard isReady, let webView else { return }
            let color = NSColor.controlAccentColor.usingColorSpace(.sRGB) ?? .systemBlue
            let hex = String(
                format: "#%02X%02X%02X",
                Int(color.redComponent * 255),
                Int(color.greenComponent * 255),
                Int(color.blueComponent * 255)
            )
            webView.callAsyncJavaScript(
                "window.mdev.setAccent(color)",
                arguments: ["color": hex],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "error":
                previewLog.error("Preview JS: \(String(describing: body["message"] ?? ""), privacy: .public)")
            case "ready":
                previewLog.info("Preview ready")
                isReady = true
                renderedText = nil
                appliedSettings = nil
                applyAccentColor()
                applyStyleIfNeeded()
                scheduleRender()
            case "scroll":
                if let line = body["line"] as? Int {
                    parent.onEvent(.scrolled(line: line))
                }
            case "task":
                if let line = body["line"] as? Int, let checked = body["checked"] as? Bool {
                    parent.onEvent(.taskToggled(line: line, checked: checked))
                }
            case "link":
                if let href = body["href"] as? String {
                    parent.onEvent(.linkActivated(href))
                }
            case "wikilink":
                if let target = body["target"] as? String {
                    parent.onEvent(.wikiLinkActivated(target))
                }
            default:
                break
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            // Only the bundled page may load in the preview; links are handled by the host.
            let isPreviewPage = navigationAction.request.url?.scheme == LocalSchemeHandler.appScheme
            if !isPreviewPage, let href = navigationAction.request.url?.absoluteString {
                parent.onEvent(.linkActivated(href))
            }
            decisionHandler(isPreviewPage ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            previewLog.error("Preview page failed to load: \(error.localizedDescription, privacy: .public)")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            previewLog.info("Preview page loaded")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            previewLog.error("Preview web process terminated; reloading")
            isReady = false
            renderedText = nil
            webView.load(URLRequest(url: LocalSchemeHandler.pageURL))
        }
    }
}

/// `WKUserContentController` retains its handlers strongly.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: (any WKScriptMessageHandler)?

    init(_ target: any WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

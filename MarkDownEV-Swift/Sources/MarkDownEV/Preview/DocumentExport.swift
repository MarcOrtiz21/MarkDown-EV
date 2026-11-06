import AppKit
import UniformTypeIdentifiers

@MainActor
enum DocumentExport {
    static func saveHTML(from preview: PreviewController, title: String, suggestedDirectory: URL?) async {
        guard let html = await preview.exportHTML(title: title) else {
            NSSound.beep()
            return
        }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = "\(title).html"
        panel.directoryURL = suggestedDirectory
        panel.canCreateDirectories = true

        let response: NSApplication.ModalResponse
        if let window = preview.window {
            response = await panel.beginSheetModal(for: window)
        } else {
            response = panel.runModal()
        }
        guard response == .OK, let url = panel.url else { return }

        do {
            try Data(embedLocalImages(in: html).utf8).write(to: url, options: .atomic)
        } catch {
            NSApp.presentError(error)
        }
    }

    /// Puts HTML, RTF and the original Markdown on the pasteboard so Pages, Mail,
    /// Notes or a code editor each pick the richest flavour they understand.
    static func copyRichText(from preview: PreviewController, markdown: String, title: String) async {
        guard let rawHTML = await preview.exportHTML(title: title) else {
            NSSound.beep()
            return
        }
        let html = embedLocalImages(in: rawHTML)
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(html, forType: .html)
        if let attributed = NSAttributedString(html: Data(html.utf8), options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil),
           let rtf = attributed.rtf(from: NSRange(location: 0, length: attributed.length)) {
            pasteboard.setData(rtf, forType: .rtf)
        }
        pasteboard.setString(markdown, forType: .string)
    }

    /// Replaces `app-image://local/…` references (only resolvable inside the app)
    /// with data URIs, making the exported HTML self-contained.
    nonisolated static func embedLocalImages(in html: String) -> String {
        let pattern = #"app-image://local/([^"'\s)<>]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return html }
        let source = html as NSString
        let result = NSMutableString(string: html)

        for match in regex.matches(in: html, range: NSRange(location: 0, length: source.length)).reversed() {
            let encoded = source.substring(with: match.range(at: 1))
            guard let path = encoded.removingPercentEncoding,
                  let data = try? Data(contentsOf: URL(fileURLWithPath: path))
            else { continue }
            let mime = UTType(filenameExtension: (path as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            result.replaceCharacters(in: match.range, with: "data:\(mime);base64,\(data.base64EncodedString())")
        }
        return result as String
    }
}

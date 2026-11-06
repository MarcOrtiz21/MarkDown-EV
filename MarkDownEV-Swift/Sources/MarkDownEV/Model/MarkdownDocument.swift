import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let markdownText = UTType(importedAs: "net.daringfireball.markdown", conformingTo: .plainText)
}

/// Undo registration (and therefore the "edited" state) comes from the editor's
/// `NSTextView`, which registers its changes with the document's undo manager.
final class MarkdownDocument: ReferenceFileDocument, @unchecked Sendable {
    static let readableContentTypes: [UTType] = [.markdownText, .plainText]
    static let writableContentTypes: [UTType] = [.markdownText, .plainText]

    @Published var text: String

    init(text: String = "") {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = try Self.decode(data)
    }

    func snapshot(contentType: UTType) throws -> String {
        text
    }

    func fileWrapper(snapshot: String, configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(snapshot.utf8))
    }

    static func decode(_ data: Data) throws -> String {
        if data.starts(with: [0xEF, 0xBB, 0xBF]), let text = String(data: data.dropFirst(3), encoding: .utf8) {
            return text
        }
        if let text = String(data: data, encoding: .utf8) {
            return text
        }
        let hasUTF16BOM = data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF])
        if hasUTF16BOM, let text = String(data: data, encoding: .utf16) {
            return text
        }
        for encoding in [String.Encoding.windowsCP1252, .macOSRoman] {
            if let text = String(data: data, encoding: encoding) {
                return text
            }
        }
        throw CocoaError(.fileReadInapplicableStringEncoding)
    }
}

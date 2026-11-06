import AppKit
import Testing
@testable import MarkDownEV

@MainActor
@Suite struct ImageAndExportTests {
    private let folder: URL
    private let document: URL
    private let pasteboard = NSPasteboard(name: NSPasteboard.Name("mdev-tests-\(UUID().uuidString)"))

    init() throws {
        folder = FileManager.default.temporaryDirectory
            .appending(path: "mdev-images-\(UUID().uuidString)/Mis notas", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder.appending(path: "fotos"), withIntermediateDirectories: true)
        document = folder.appending(path: "nota.md")
        try Data().write(to: document)
    }

    private func pngData() -> Data {
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        )!
        return bitmap.representation(using: .png, properties: [:])!
    }

    @Test func relativePathsWalkUpAndDown() {
        let base = URL(fileURLWithPath: "/a/b/notas")
        #expect(ImageImporter.relativePath(of: URL(fileURLWithPath: "/a/b/notas/assets/x.png"), from: base) == "assets/x.png")
        #expect(ImageImporter.relativePath(of: URL(fileURLWithPath: "/a/img/x.png"), from: base) == "../../img/x.png")
    }

    @Test func linksWithSpacesUseAngleBrackets() {
        let link = ImageImporter.link(to: folder.appending(path: "fotos/mi foto.png"), from: folder)
        #expect(link == "![mi foto](<fotos/mi foto.png>)")
    }

    @Test func pastedScreenshotIsStoredInAssets() throws {
        pasteboard.clearContents()
        pasteboard.setData(pngData(), forType: .png)

        let markdown = try #require(try ImageImporter.markdown(for: pasteboard, documentURL: document))
        #expect(markdown.hasPrefix("![imagen-"))
        #expect(markdown.contains("](assets/imagen-"))
        let stored = try FileManager.default.contentsOfDirectory(atPath: folder.appending(path: "assets").path)
        #expect(stored.count == 1)
    }

    @Test func imagesInsideTheDocumentFolderAreLinkedNotCopied() throws {
        let photo = folder.appending(path: "fotos/playa.png")
        try pngData().write(to: photo)
        pasteboard.clearContents()
        pasteboard.writeObjects([photo as NSURL])

        let markdown = try ImageImporter.markdown(for: pasteboard, documentURL: document)
        #expect(markdown == "![playa](fotos/playa.png)")
        #expect(!FileManager.default.fileExists(atPath: folder.appending(path: "assets").path))
    }

    @Test func textCopiesAreNotTreatedAsImages() throws {
        pasteboard.clearContents()
        pasteboard.setString("hola", forType: .string)
        pasteboard.setData(pngData(), forType: .png)
        #expect(!ImageImporter.containsImage(pasteboard))
        #expect(try ImageImporter.markdown(for: pasteboard, documentURL: document) == nil)
    }

    @Test func unsavedDocumentsCannotReceiveImages() {
        pasteboard.clearContents()
        pasteboard.setData(pngData(), forType: .png)
        #expect(throws: ImageImportError.self) {
            try ImageImporter.markdown(for: pasteboard, documentURL: nil)
        }
    }

    @Test func exportEmbedsLocalImagesAsDataURIs() throws {
        let photo = folder.appending(path: "fotos/playa.png")
        try pngData().write(to: photo)
        let encoded = try #require(photo.path.addingPercentEncoding(withAllowedCharacters: .alphanumerics))
        let html = #"<img src="app-image://local/\#(encoded)" alt="x"><img src="https://example.com/a.png">"#

        let embedded = DocumentExport.embedLocalImages(in: html)
        #expect(embedded.contains(#"src="data:image/png;base64,"#))
        #expect(embedded.contains("https://example.com/a.png"))
        #expect(!embedded.contains("app-image://"))
    }
}

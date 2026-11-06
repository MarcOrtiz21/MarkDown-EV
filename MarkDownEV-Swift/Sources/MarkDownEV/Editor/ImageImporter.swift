import AppKit
import UniformTypeIdentifiers

enum ImageImportError: LocalizedError {
    case documentNotSaved

    var errorDescription: String? {
        "Guarda el documento antes de añadir imágenes."
    }

    var recoverySuggestion: String? {
        "Las imágenes se guardan en la carpeta «assets» junto al documento y se enlazan con una ruta relativa."
    }
}

/// Turns pasted or dropped images into Markdown image links, storing new image
/// data in an `assets` folder next to the document.
enum ImageImporter {
    static let assetsFolder = "assets"
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "tif", "tiff", "bmp"]

    static func containsImage(_ pasteboard: NSPasteboard) -> Bool {
        !imageFileURLs(in: pasteboard).isEmpty || hasRawImageOnly(pasteboard)
    }

    /// Markdown to insert for the images on `pasteboard`, or `nil` if it holds none.
    static func markdown(for pasteboard: NSPasteboard, documentURL: URL?) throws -> String? {
        let files = imageFileURLs(in: pasteboard)
        let data = files.isEmpty ? pastedImageData(from: pasteboard) : nil
        guard !files.isEmpty || data != nil else { return nil }
        guard let directory = documentURL?.deletingLastPathComponent() else { throw ImageImportError.documentNotSaved }

        if let data {
            let url = try store(data, extension: "png", in: directory)
            return link(to: url, from: directory)
        }
        return try files.map { file in
            let target = isInside(file, directory) ? file : try copy(file, into: directory)
            return link(to: target, from: directory)
        }
        .joined(separator: "\n")
    }

    static func link(to file: URL, from directory: URL) -> String {
        let path = relativePath(of: file, from: directory)
        let alt = file.deletingPathExtension().lastPathComponent
        let destination = path.contains(" ") ? "<\(path)>" : path
        return "![\(alt)](\(destination))"
    }

    static func relativePath(of file: URL, from directory: URL) -> String {
        let base = directory.standardizedFileURL.pathComponents
        let target = file.standardizedFileURL.pathComponents
        let common = zip(base, target).prefix { $0 == $1 }.count
        let ups = Array(repeating: "..", count: base.count - common)
        return (ups + target.dropFirst(common)).joined(separator: "/")
    }

    // MARK: - Private

    private static func imageFileURLs(in pasteboard: NSPasteboard) -> [URL] {
        let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        return urls.filter { imageExtensions.contains($0.pathExtension.lowercased()) }
    }

    /// Screenshots and images copied from apps. Text copies and Finder file copies
    /// also carry a TIFF (a rendering or the file icon), which must not win over them.
    private static func hasRawImageOnly(_ pasteboard: NSPasteboard) -> Bool {
        pasteboard.availableType(from: [.png, .tiff]) != nil
            && pasteboard.availableType(from: [.string, .fileURL]) == nil
    }

    private static func pastedImageData(from pasteboard: NSPasteboard) -> Data? {
        guard hasRawImageOnly(pasteboard) else { return nil }
        if let png = pasteboard.data(forType: .png) { return png }
        guard let tiff = pasteboard.data(forType: .tiff), let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }

    private static func isInside(_ file: URL, _ directory: URL) -> Bool {
        file.standardizedFileURL.path.hasPrefix(directory.standardizedFileURL.path + "/")
    }

    private static func assetsDirectory(in directory: URL) throws -> URL {
        let assets = directory.appending(path: assetsFolder, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
        return assets
    }

    private static func store(_ data: Data, extension ext: String, in directory: URL) throws -> URL {
        let stamp = Date().formatted(.verbatim("\(year: .defaultDigits)\(month: .twoDigits)\(day: .twoDigits)-\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased))\(minute: .twoDigits)\(second: .twoDigits)", timeZone: .current, calendar: .current))
        let url = WorkspaceFiles.availableURL(in: try assetsDirectory(in: directory), baseName: "imagen-\(stamp)", extension: ext)
        try data.write(to: url, options: .withoutOverwriting)
        return url
    }

    private static func copy(_ file: URL, into directory: URL) throws -> URL {
        let assets = try assetsDirectory(in: directory)
        let name = file.deletingPathExtension().lastPathComponent
        let destination = WorkspaceFiles.availableURL(in: assets, baseName: name, extension: file.pathExtension.lowercased())
        try FileManager.default.copyItem(at: file, to: destination)
        return destination
    }
}

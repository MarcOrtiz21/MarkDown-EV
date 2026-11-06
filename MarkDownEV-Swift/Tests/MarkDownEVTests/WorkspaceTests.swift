import Foundation
import Testing
@testable import MarkDownEV

@Suite struct WorkspaceTests {
    private let root: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appending(path: "mdev-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let fm = FileManager.default
        try fm.createDirectory(at: root.appending(path: "Notas/Sub"), withIntermediateDirectories: true)
        try fm.createDirectory(at: root.appending(path: "node_modules"), withIntermediateDirectories: true)
        try fm.createDirectory(at: root.appending(path: ".git"), withIntermediateDirectories: true)
        try "# Inicio\nVer [[Receta]]\nCanción de prueba".write(to: root.appending(path: "Inicio.md"), atomically: true, encoding: .utf8)
        try "Ingredientes: azúcar\n- [ ] comprar azucar".write(to: root.appending(path: "Notas/Sub/Receta.md"), atomically: true, encoding: .utf8)
        try "azucar oculto".write(to: root.appending(path: "node_modules/leeme.md"), atomically: true, encoding: .utf8)
        try "azucar".write(to: root.appending(path: ".git/HEAD.md"), atomically: true, encoding: .utf8)
        try Data().write(to: root.appending(path: "foto.png"))
    }

    @Test func listShowsFoldersFirstAndOnlyDocuments() {
        let names = WorkspaceFiles.list(root).map(\.name)
        #expect(names == ["Notas", "Inicio.md"])
    }

    @Test func searchIsAccentInsensitiveAndSkipsIgnoredFolders() throws {
        let results = try WorkspaceSearch.run("AZUCAR", in: root)
        #expect(results.map(\.relativePath) == ["Notas/Sub/Receta.md"])
        let matches = try #require(results.first?.matches)
        #expect(matches.map(\.line) == [0, 1])
        #expect(matches[0].preview[matches[0].highlight] == "azúcar")
    }

    @Test func longLinesAreTrimmedAroundTheMatch() {
        let line = String(repeating: "a ", count: 200) + "aguja" + String(repeating: " b", count: 200)
        let match = WorkspaceSearch.search("aguja", in: line, limit: 1)[0]
        #expect(match.preview.hasPrefix("…"))
        #expect(match.preview.hasSuffix("…"))
        #expect(match.preview[match.highlight] == "aguja")
        #expect(match.preview.count < 160)
    }

    @Test func wikiLinksResolveAnywhereInTheWorkspace() {
        let found = WorkspaceFiles.resolveWikiLink("receta", near: root, in: root)
        #expect(found?.lastPathComponent == "Receta.md")
        #expect(WorkspaceFiles.resolveWikiLink("No existe", near: root, in: root) == nil)
    }

    @Test func newNotesGetUniqueNames() throws {
        let first = WorkspaceFiles.availableURL(in: root)
        try Data().write(to: first)
        let second = WorkspaceFiles.availableURL(in: root)
        #expect(first.lastPathComponent == "Sin título.md")
        #expect(second.lastPathComponent == "Sin título 2.md")
    }
}

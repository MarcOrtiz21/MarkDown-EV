import Foundation
import Testing
@testable import MarkDownEV

@Suite struct MarkdownTextTests {
    @Test func outlineSkipsFencedCodeAndKeepsSourceLines() {
        let text = """
        # Título
        texto
        ```bash
        # no es un encabezado
        ```
        ## Sección ##
        #sin-espacio
        """
        let outline = MarkdownText.outline(of: text)
        #expect(outline.map(\.title) == ["Título", "Sección"])
        #expect(outline.map(\.line) == [0, 5])
        #expect(outline.map(\.level) == [1, 2])
    }

    @Test func activeHeadingFollowsTheReadingPosition() {
        let headings = MarkdownText.outline(of: "intro\n# Uno\ntexto\n## Dos\nmás\n# Tres")
        #expect(MarkdownText.activeHeading(in: headings, atLine: 0)?.title == "Uno")
        #expect(MarkdownText.activeHeading(in: headings, atLine: 2)?.title == "Uno")
        #expect(MarkdownText.activeHeading(in: headings, atLine: 3)?.title == "Dos")
        #expect(MarkdownText.activeHeading(in: headings, atLine: 99)?.title == "Tres")
        #expect(MarkdownText.activeHeading(in: [], atLine: 3) == nil)
    }

    @Test func taskMarkerRangeFindsCheckboxOnRequestedLine() throws {
        let text = "intro\n- [ ] pendiente\n  1. [x] hecha\n- normal" as NSString
        let open = try #require(MarkdownText.taskMarkerRange(in: text, line: 1))
        #expect(text.substring(with: open) == " ")
        let done = try #require(MarkdownText.taskMarkerRange(in: text, line: 2))
        #expect(text.substring(with: done) == "x")
        #expect(MarkdownText.taskMarkerRange(in: text, line: 3) == nil)
        #expect(MarkdownText.taskMarkerRange(in: text, line: 9) == nil)
    }

    @Test func statsCountWords() {
        let stats = MarkdownText.stats(of: "Hola, mundo. Esto es un-ejemplo de l'app.")
        #expect(stats.words == 7)
        #expect(stats.readingMinutes == 1)
    }

    @Test func decodeHandlesBOMAndLegacyEncodings() throws {
        #expect(try MarkdownDocument.decode(Data([0xEF, 0xBB, 0xBF]) + Data("ñ".utf8)) == "ñ")
        let latin = try #require("Canción".data(using: .windowsCP1252))
        #expect(try MarkdownDocument.decode(latin) == "Canción")
    }
}

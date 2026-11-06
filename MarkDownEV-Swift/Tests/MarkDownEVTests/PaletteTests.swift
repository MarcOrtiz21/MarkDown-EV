import AppKit
import Testing
@testable import MarkDownEV

@Suite struct PaletteTests {
    @Test func fuzzyMatchesSubsequencesIgnoringCaseAndAccents() {
        #expect(FuzzyMatcher.score("ntsrec", in: "Notas/Receta") != nil)
        #expect(FuzzyMatcher.score("CANCION", in: "Canción de cuna") != nil)
        #expect(FuzzyMatcher.score("xyz", in: "Notas/Receta") == nil)
        #expect(FuzzyMatcher.score("", in: "Lo que sea") == 0)
    }

    @Test func fuzzyPrefersWordStartsAndConsecutiveLetters() throws {
        let wordStart = try #require(FuzzyMatcher.score("rec", in: "Notas/Receta"))
        let scattered = try #require(FuzzyMatcher.score("rec", in: "Notas/arbol de cerezo"))
        #expect(wordStart > scattered)

        let short = try #require(FuzzyMatcher.score("vista", in: "Vista previa"))
        let long = try #require(FuzzyMatcher.score("vista", in: "Vista previa del documento completo"))
        #expect(short > long)
    }

    @Test func editorFontsFollowTheChosenDesign() {
        let mono = EditorSettings(font: .monospaced, fontSize: 15).makeFont()
        #expect(mono.pointSize == 15)
        #expect(mono.isFixedPitch)

        let serif = EditorSettings(font: .serif, fontSize: 18).makeFont(italic: true)
        #expect(serif.pointSize == 18)
        #expect(!serif.isFixedPitch)
        #expect(serif.fontDescriptor.symbolicTraits.contains(.italic))
    }
}

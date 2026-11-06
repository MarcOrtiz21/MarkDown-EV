import AppKit
import SwiftUI

enum SettingsKey {
    static let editorFont = "editorFont"
    static let editorFontSize = "editorFontSize"
    static let editorLineSpacing = "editorLineSpacing"
    static let readableWidth = "readableWidth"
    static let spellCheck = "spellCheck"
    static let vimMode = "vimMode"
    static let previewFont = "previewFont"
    static let previewFontSize = "previewFontSize"
    static let syncScroll = "syncScroll"
    static let appearance = "appearance"
}

enum EditorFontStyle: String, CaseIterable, Identifiable {
    case monospaced
    case system
    case serif

    var id: Self { self }

    var title: String {
        switch self {
        case .monospaced: "Monoespaciada (SF Mono)"
        case .system: "Sistema (SF Pro)"
        case .serif: "Serif (New York)"
        }
    }

    var design: NSFontDescriptor.SystemDesign {
        switch self {
        case .monospaced: .monospaced
        case .system: .default
        case .serif: .serif
        }
    }
}

enum PreviewFontStyle: String, CaseIterable, Identifiable {
    case system
    case serif

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "Sistema (SF Pro)"
        case .serif: "Serif (New York)"
        }
    }
}

enum AppearancePreference: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "Automática"
        case .light: "Clara"
        case .dark: "Oscura"
        }
    }

    var nsAppearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }

    @MainActor
    static func apply(_ rawValue: String) {
        NSApp.appearance = (AppearancePreference(rawValue: rawValue) ?? .system).nsAppearance
    }
}

/// Everything the editor needs to lay out text; rebuilt when a preference changes.
struct EditorSettings: Equatable {
    var font: EditorFontStyle = .monospaced
    var fontSize: Double = 14
    var lineSpacing: Double = 1.25
    var readableWidth: Double = 780
    var spellCheck = true
    var vimMode = false

    func makeFont(weight: NSFont.Weight = .regular, italic: Bool = false) -> NSFont {
        let size = CGFloat(fontSize)
        var descriptor = NSFont.systemFont(ofSize: size, weight: weight).fontDescriptor
        descriptor = descriptor.withDesign(font.design) ?? descriptor
        if italic {
            descriptor = descriptor.withSymbolicTraits(.italic)
        }
        return NSFont(descriptor: descriptor, size: size) ?? .monospacedSystemFont(ofSize: size, weight: weight)
    }
}

struct PreviewSettings: Equatable {
    var font: PreviewFontStyle = .system
    var fontSize: Double = 16
}

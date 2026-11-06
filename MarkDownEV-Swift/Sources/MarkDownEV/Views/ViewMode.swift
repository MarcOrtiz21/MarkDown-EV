import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    case editor
    case split
    case preview

    var id: Self { self }

    var title: String {
        switch self {
        case .editor: "Editor"
        case .split: "Dividido"
        case .preview: "Vista previa"
        }
    }

    var systemImage: String {
        switch self {
        case .editor: "square.and.pencil"
        case .split: "rectangle.split.2x1"
        case .preview: "doc.richtext"
        }
    }

    var shortcut: KeyEquivalent {
        switch self {
        case .editor: "1"
        case .split: "2"
        case .preview: "3"
        }
    }

    var showsEditor: Bool { self != .preview }
    var showsPreview: Bool { self != .editor }
}

extension FocusedValues {
    @Entry var viewMode: Binding<ViewMode>?
    @Entry var windowActions: WindowActions?
}

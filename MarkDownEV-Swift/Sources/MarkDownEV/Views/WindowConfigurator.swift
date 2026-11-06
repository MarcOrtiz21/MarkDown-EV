import AppKit
import SwiftUI

/// Gives access to the hosting `NSWindow` once the view is attached to it.
struct WindowConfigurator: NSViewRepresentable {
    let configure: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        ConfiguringView(configure: configure)
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class ConfiguringView: NSView {
        let configure: (NSWindow) -> Void

        init(configure: @escaping (NSWindow) -> Void) {
            self.configure = configure
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { configure(window) }
        }
    }
}

/// Window-level commands the menu bar can trigger on the focused document window.
@MainActor
final class WindowActions {
    var openFolder: () -> Void = {}
    var newNoteInFolder: () -> Void = {}
    var searchInFolder: () -> Void = {}
    var showSidebarTab: (SidebarTab) -> Void = { _ in }
    var toggleSidebar: () -> Void = {}
    var setViewMode: (ViewMode) -> Void = { _ in }
    var showPalette: (PaletteMode) -> Void = { _ in }
    var printDocument: () -> Void = {}
    var exportHTML: () -> Void = {}
    var copyRichText: () -> Void = {}
}

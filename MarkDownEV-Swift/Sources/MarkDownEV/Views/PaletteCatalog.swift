import AppKit
import SwiftUI

/// Builds the entries the command palette offers for one document window.
@MainActor
enum PaletteCatalog {
    static func commands(actions: WindowActions, fileURL: URL?, openSettings: @escaping @MainActor () -> Void) -> [PaletteItem] {
        var items: [PaletteItem] = [
            PaletteItem(id: "cmd.new", title: "Nuevo documento", systemImage: "doc.badge.plus", shortcut: "⌘N") {
                NSDocumentController.shared.newDocument(nil)
            },
            PaletteItem(id: "cmd.open", title: "Abrir…", systemImage: "doc", shortcut: "⌘O") {
                NSDocumentController.shared.openDocument(nil)
            },
            PaletteItem(id: "cmd.quickOpen", title: "Abrir rápido", systemImage: "bolt", shortcut: "⇧⌘O") {
                actions.showPalette(.files)
            },
            PaletteItem(id: "cmd.heading", title: "Ir a encabezado", systemImage: "number", shortcut: "#") {
                actions.showPalette(.headings)
            },
            PaletteItem(id: "cmd.openFolder", title: "Abrir carpeta…", systemImage: "folder", shortcut: "⌥⌘O") {
                actions.openFolder()
            },
            PaletteItem(id: "cmd.newNote", title: "Nueva nota en la carpeta", systemImage: "square.and.pencil") {
                actions.newNoteInFolder()
            },
            PaletteItem(id: "cmd.search", title: "Buscar en la carpeta", systemImage: "magnifyingglass", shortcut: "⇧⌘F") {
                actions.searchInFolder()
            },
        ]

        items += ViewMode.allCases.map { mode in
            PaletteItem(
                id: "cmd.view.\(mode.rawValue)",
                title: "Vista: \(mode.title)",
                systemImage: mode.systemImage,
                shortcut: "⌘\(String(mode.shortcut.character))"
            ) { actions.setViewMode(mode) }
        }

        items += [
            PaletteItem(id: "cmd.sidebar", title: "Mostrar u ocultar barra lateral", systemImage: "sidebar.left", shortcut: "⌃⌘S") {
                actions.toggleSidebar()
            },
            PaletteItem(id: "cmd.files", title: "Mostrar archivos", systemImage: "folder", shortcut: "⌥⌘1") {
                actions.showSidebarTab(.files)
            },
            PaletteItem(id: "cmd.outline", title: "Mostrar índice", systemImage: "list.bullet.indent", shortcut: "⌥⌘2") {
                actions.showSidebarTab(.outline)
            },
            PaletteItem(id: "cmd.print", title: "Imprimir o exportar PDF", systemImage: "printer", shortcut: "⌘P") {
                actions.printDocument()
            },
            PaletteItem(id: "cmd.exportHTML", title: "Exportar como HTML…", systemImage: "chevron.left.forwardslash.chevron.right", shortcut: "⇧⌘E") {
                actions.exportHTML()
            },
            PaletteItem(id: "cmd.copyRich", title: "Copiar como texto enriquecido", systemImage: "doc.on.clipboard", shortcut: "⌥⌘C") {
                actions.copyRichText()
            },
        ]

        if let fileURL {
            items.append(PaletteItem(id: "cmd.reveal", title: "Mostrar en Finder", systemImage: "finder") {
                NSWorkspace.shared.activateFileViewerSelecting([fileURL])
            })
        }

        items += AppearancePreference.allCases.map { appearance in
            PaletteItem(id: "cmd.appearance.\(appearance.rawValue)", title: "Apariencia: \(appearance.title)", systemImage: "circle.lefthalf.filled") {
                UserDefaults.standard.set(appearance.rawValue, forKey: SettingsKey.appearance)
                AppearancePreference.apply(appearance.rawValue)
            }
        }

        let vimEnabled = UserDefaults.standard.bool(forKey: SettingsKey.vimMode)
        items.append(PaletteItem(
            id: "cmd.vim",
            title: vimEnabled ? "Desactivar modo Vim" : "Activar modo Vim",
            systemImage: "keyboard"
        ) {
            UserDefaults.standard.set(!vimEnabled, forKey: SettingsKey.vimMode)
        })
        items.append(PaletteItem(id: "cmd.settings", title: "Ajustes…", systemImage: "gearshape", shortcut: "⌘,", action: openSettings))
        return items
    }

    static func files(_ urls: [URL], root: URL?) -> [PaletteItem] {
        let rootPath = root?.standardizedFileURL.path ?? ""
        return urls.map { url in
            let folder = url.deletingLastPathComponent().standardizedFileURL.path
            let relativeFolder = folder.hasPrefix(rootPath) ? String(folder.dropFirst(rootPath.count)).trimmingCharacters(in: ["/"]) : folder
            return PaletteItem(
                id: "file.\(url.path)",
                title: url.deletingPathExtension().lastPathComponent,
                subtitle: relativeFolder,
                systemImage: "doc.text"
            ) { DocumentNavigator.open(url) }
        }
    }

    static func headings(_ headings: [OutlineHeading], goTo: @escaping @MainActor (Int) -> Void) -> [PaletteItem] {
        headings.map { heading in
            PaletteItem(
                id: "heading.\(heading.line)",
                title: String(repeating: "  ", count: heading.level - 1) + heading.title,
                systemImage: "number",
                shortcut: "H\(heading.level)"
            ) { goTo(heading.line) }
        }
    }
}

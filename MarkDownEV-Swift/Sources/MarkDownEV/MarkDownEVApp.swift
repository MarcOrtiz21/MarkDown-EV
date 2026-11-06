import AppKit
import SwiftUI

@main
struct MarkDownEVApp: App {
    @NSApplicationDelegateAdaptor private var appDelegate: AppDelegate

    var body: some Scene {
        DocumentGroup(newDocument: { MarkdownDocument() }) { file in
            DocumentView(document: file.document, fileURL: file.fileURL)
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            AppCommands()
        }

        Settings {
            SettingsView()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        AppearancePreference.apply(UserDefaults.standard.string(forKey: SettingsKey.appearance) ?? "")
    }
}

private struct AppCommands: Commands {
    @FocusedValue(\.viewMode) private var viewMode
    @FocusedValue(\.windowActions) private var actions

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Abrir rápido…") { actions?.showPalette(.files) }
                .keyboardShortcut("o", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Button("Abrir carpeta…") { actions?.openFolder() }
                .keyboardShortcut("o", modifiers: [.command, .option])
                .disabled(actions == nil)
            Button("Nueva nota en la carpeta") { actions?.newNoteInFolder() }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(actions == nil)
        }
        CommandGroup(after: .saveItem) {
            Button("Exportar como HTML…") { actions?.exportHTML() }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(actions == nil)
        }
        CommandGroup(after: .pasteboard) {
            Button("Copiar como texto enriquecido") { actions?.copyRichText() }
                .keyboardShortcut("c", modifiers: [.command, .option])
                .disabled(actions == nil)
        }
        CommandGroup(after: .textEditing) {
            Button("Buscar en la carpeta") { actions?.searchInFolder() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                .disabled(actions == nil)
        }
        CommandGroup(before: .sidebar) {
            Button("Paleta de comandos…") { actions?.showPalette(.commands) }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Divider()
            ForEach(ViewMode.allCases) { mode in
                Button(mode.title) { viewMode?.wrappedValue = mode }
                    .keyboardShortcut(mode.shortcut, modifiers: .command)
                    .disabled(viewMode == nil)
            }
            Divider()
            Button("Mostrar archivos") { actions?.showSidebarTab(.files) }
                .keyboardShortcut("1", modifiers: [.command, .option])
                .disabled(actions == nil)
            Button("Mostrar índice") { actions?.showSidebarTab(.outline) }
                .keyboardShortcut("2", modifiers: [.command, .option])
                .disabled(actions == nil)
            Divider()
        }
        CommandGroup(replacing: .printItem) {
            Button("Imprimir o exportar PDF…") { actions?.printDocument() }
                .keyboardShortcut("p")
                .disabled(actions == nil)
        }
    }
}

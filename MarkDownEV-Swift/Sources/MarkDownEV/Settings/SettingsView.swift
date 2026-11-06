import SwiftUI

struct SettingsView: View {
    @AppStorage(SettingsKey.editorFont) private var editorFont: EditorFontStyle = .monospaced
    @AppStorage(SettingsKey.editorFontSize) private var editorFontSize = 14.0
    @AppStorage(SettingsKey.editorLineSpacing) private var editorLineSpacing = 1.25
    @AppStorage(SettingsKey.readableWidth) private var readableWidth = 780.0
    @AppStorage(SettingsKey.spellCheck) private var spellCheck = true
    @AppStorage(SettingsKey.vimMode) private var vimMode = false
    @AppStorage(SettingsKey.previewFont) private var previewFont: PreviewFontStyle = .system
    @AppStorage(SettingsKey.previewFontSize) private var previewFontSize = 16.0
    @AppStorage(SettingsKey.syncScroll) private var syncScroll = true
    @AppStorage(SettingsKey.appearance) private var appearance: AppearancePreference = .system

    var body: some View {
        Form {
            Section("General") {
                Picker("Apariencia", selection: $appearance) {
                    ForEach(AppearancePreference.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                Toggle("Sincronizar scroll entre editor y vista previa", isOn: $syncScroll)
            }

            Section("Editor") {
                Picker("Tipo de letra", selection: $editorFont) {
                    ForEach(EditorFontStyle.allCases) { Text($0.title).tag($0) }
                }
                LabeledContent("Tamaño") {
                    Stepper("\(Int(editorFontSize)) pt", value: $editorFontSize, in: 10...28)
                }
                LabeledContent("Interlineado") {
                    Slider(value: $editorLineSpacing, in: 1.0...2.0, step: 0.05) {
                        EmptyView()
                    } minimumValueLabel: {
                        Image(systemName: "text.alignleft").imageScale(.small)
                    } maximumValueLabel: {
                        Image(systemName: "text.alignleft").imageScale(.large)
                    }
                }
                LabeledContent("Ancho de línea") {
                    Slider(value: $readableWidth, in: 560...1400, step: 20) {
                        EmptyView()
                    } minimumValueLabel: {
                        Text("Estrecho").font(.caption)
                    } maximumValueLabel: {
                        Text("Ancho").font(.caption)
                    }
                }
                Toggle("Revisar ortografía mientras escribo", isOn: $spellCheck)
                Toggle(isOn: $vimMode) {
                    Text("Modo Vim")
                    Text("Modos normal, inserción y visual, operadores, «.» y :w / :q.")
                }
            }

            Section("Vista previa") {
                Picker("Tipo de letra", selection: $previewFont) {
                    ForEach(PreviewFontStyle.allCases) { Text($0.title).tag($0) }
                }
                LabeledContent("Tamaño") {
                    Stepper("\(Int(previewFontSize)) pt", value: $previewFontSize, in: 12...26)
                }
            }

            Section {
                HStack {
                    Spacer()
                    Button("Restablecer valores") { resetAll() }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 500)
        .fixedSize(horizontal: false, vertical: true)
        .onChange(of: appearance) { _, value in AppearancePreference.apply(value.rawValue) }
    }

    private func resetAll() {
        editorFont = .monospaced
        editorFontSize = 14
        editorLineSpacing = 1.25
        readableWidth = 780
        spellCheck = true
        vimMode = false
        previewFont = .system
        previewFontSize = 16
        syncScroll = true
        appearance = .system
    }
}

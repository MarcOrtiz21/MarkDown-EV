import AppKit

/// Applies Markdown syntax colouring to the editor's text storage.
/// Colours are dynamic system colours, so light/dark changes need no re-highlight.
final class MarkdownHighlighter: NSObject, NSTextStorageDelegate {
    private struct Rule {
        let regex: NSRegularExpression
        let attributes: [NSAttributedString.Key: Any]
        var group = 0
    }

    let baseFont: NSFont
    private let rules: [Rule]
    private let codeBlockRule: Rule

    let paragraphStyle: NSParagraphStyle

    var baseAttributes: [NSAttributedString.Key: Any] {
        [.font: baseFont, .foregroundColor: NSColor.labelColor, .paragraphStyle: paragraphStyle]
    }

    init(settings: EditorSettings = EditorSettings()) {
        let base = settings.makeFont()
        let bold = settings.makeFont(weight: .bold)
        let italic = settings.makeFont(italic: true)
        // Code stays monospaced even when the prose font is proportional.
        let code = NSFont.monospacedSystemFont(ofSize: CGFloat(settings.fontSize) * 0.94, weight: .regular)
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = CGFloat(settings.lineSpacing)
        paragraphStyle = style
        let muted = NSColor.tertiaryLabelColor
        let secondary = NSColor.secondaryLabelColor
        let accent = NSColor.controlAccentColor
        let codeBackground = NSColor.quaternaryLabelColor.withAlphaComponent(0.12)

        func rule(_ pattern: String, _ attributes: [NSAttributedString.Key: Any], group: Int = 0) -> Rule {
            // Patterns are compile-time constants; a failure here is a programming error.
            let regex = try! NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
            return Rule(regex: regex, attributes: attributes, group: group)
        }

        baseFont = base
        rules = [
            rule(#"^#{1,6}[ \t].*$"#, [.font: bold]),
            rule(#"^(#{1,6})[ \t]"#, [.foregroundColor: muted], group: 1),
            rule(#"^ {0,3}>.*$"#, [.foregroundColor: secondary, .font: italic]),
            rule(#"^\s*(?:[-*+]|\d+[.)])(?=\s)"#, [.foregroundColor: accent]),
            rule(#"^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\])"#, [.foregroundColor: accent], group: 1),
            rule(#"^ {0,3}(?:[-*_][ \t]*){3,}$"#, [.foregroundColor: muted]),
            rule(#"(\*\*|__)(?=\S)[^\n]*?\S\1"#, [.font: bold]),
            rule(#"(?<![*\w])\*(?![\s*])[^*\n]+?(?<!\s)\*(?!\*)|(?<![_\w])_(?![\s_])[^_\n]+?(?<!\s)_(?![_\w])"#, [.font: italic]),
            rule(#"~~[^~\n]+~~"#, [.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: secondary]),
            rule(#"!?\[[^\]\n]*\]\([^)\n]*\)"#, [.foregroundColor: secondary]),
            rule(#"!?\[([^\]\n]*)\]\("#, [.foregroundColor: accent], group: 1),
            rule(#"\[\[[^\]\n]+\]\]"#, [.foregroundColor: accent]),
            rule(#"(?<!\\)\$\$?[^$\n]+\$\$?"#, [.foregroundColor: NSColor.systemTeal]),
            rule(#"`[^`\n]+`"#, [.foregroundColor: NSColor.systemPink, .backgroundColor: codeBackground, .font: code]),
            rule(#"<!--[\s\S]*?-->"#, [.foregroundColor: muted]),
        ]
        codeBlockRule = rule(
            #"^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|\z)"#,
            [.foregroundColor: secondary, .font: code, .backgroundColor: codeBackground]
        )
        super.init()
    }

    /// Above this size only the edited paragraphs are re-highlighted while typing.
    private let fullHighlightLimit = 150_000

    func highlight(_ storage: NSTextStorage) {
        storage.beginEditing()
        highlight(storage, in: NSRange(location: 0, length: storage.length))
        storage.endEditing()
    }

    private func highlight(_ storage: NSTextStorage, in range: NSRange) {
        let string = storage.string
        storage.setAttributes(baseAttributes, range: range)
        for rule in rules {
            apply(rule, to: storage, string: string, range: range)
        }
        apply(codeBlockRule, to: storage, string: string, range: range, replacing: true)
    }

    private func apply(_ rule: Rule, to storage: NSTextStorage, string: String, range: NSRange, replacing: Bool = false) {
        rule.regex.enumerateMatches(in: string, range: range) { match, _, _ in
            guard let match else { return }
            let target = match.range(at: rule.group)
            guard target.location != NSNotFound else { return }
            if replacing {
                storage.setAttributes(baseAttributes.merging(rule.attributes) { $1 }, range: target)
            } else {
                storage.addAttributes(rule.attributes, range: target)
            }
        }
    }

    func textStorage(
        _ textStorage: NSTextStorage,
        didProcessEditing editedMask: NSTextStorageEditActions,
        range editedRange: NSRange,
        changeInLength delta: Int
    ) {
        guard editedMask.contains(.editedCharacters) else { return }
        let string = textStorage.string as NSString
        let range = string.length > fullHighlightLimit
            ? string.paragraphRange(for: editedRange)
            : NSRange(location: 0, length: string.length)
        highlight(textStorage, in: range)
    }
}

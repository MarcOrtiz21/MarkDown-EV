import AppKit
import Testing
@testable import MarkDownEV

@MainActor
@Suite struct VimEngineTests {
    private let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 400))
    private let engine: VimEngine

    init() {
        engine = VimEngine(textView: textView)
        engine.pasteboard = NSPasteboard(name: NSPasteboard.Name("mdev-vim-\(UUID().uuidString)"))
    }

    /// `<` and `>` are literal; Escape is written as `⎋` and Return as `⏎`.
    private func run(_ text: String, cursor: Int = 0, keys: String) -> (text: String, cursor: Int) {
        textView.string = text
        textView.setSelectedRange(NSRange(location: cursor, length: 0))
        engine.reset()
        for character in keys {
            let key = character == "⎋" ? VimEngine.escape : character == "⏎" ? "\r" : String(character)
            if !engine.handle(key) {
                textView.insertText(key, replacementRange: textView.selectedRange())
            }
        }
        return (textView.string, engine.cursorLocation)
    }

    @Test func wordMotionsAndCounts() {
        #expect(run("uno dos tres cuatro", keys: "2w").cursor == 8)
        #expect(run("uno dos tres", cursor: 8, keys: "b").cursor == 4)
        #expect(run("uno dos", keys: "e").cursor == 2)
        #expect(run("uno, dos", keys: "w").cursor == 3)
        #expect(run("uno, dos", keys: "W").cursor == 5)
    }

    @Test func verticalMotionKeepsTheColumn() {
        let text = "abcdef\nab\nabcdef"
        #expect(run(text, cursor: 4, keys: "j").cursor == 8)
        #expect(run(text, cursor: 4, keys: "jj").cursor == 14)
        #expect(run(text, keys: "G").cursor == 10)
        #expect(run(text, cursor: 12, keys: "gg").cursor == 0)
    }

    @Test func deleteAndChangeWithMotions() {
        #expect(run("uno dos tres", keys: "dw").text == "dos tres")
        #expect(run("uno dos tres", keys: "d2w").text == "tres")
        #expect(run("uno dos tres", keys: "cwUNO⎋").text == "UNO dos tres")
        #expect(run("uno dos tres", cursor: 4, keys: "D").text == "uno ")
        #expect(run("uno dos\notra", cursor: 4, keys: "dw").text == "uno \notra")
        #expect(run("hola mundo", keys: "x").text == "ola mundo")
    }

    @Test func linewiseOperatorsAndPaste() {
        let text = "uno\ndos\ntres"
        #expect(run(text, keys: "dd").text == "dos\ntres")
        #expect(run(text, cursor: 8, keys: "dd").text == "uno\ndos")
        #expect(run(text, keys: "ddp").text == "dos\nuno\ntres")
        #expect(run(text, keys: "yyP").text == "uno\nuno\ndos\ntres")
        #expect(run(text, cursor: 8, keys: "yyp").text == "uno\ndos\ntres\ntres")
        #expect(run(text, keys: "2dd").text == "tres")
        #expect(run(text, cursor: 4, keys: "ccDOS⎋").text == "uno\nDOS\ntres")
    }

    @Test func textObjects() {
        #expect(run("di [hola mundo] fin", cursor: 6, keys: "di[").text == "di [] fin")
        #expect(run("f(a, (b))", cursor: 6, keys: "da(").text == "f(a, )")
        #expect(run("dice \"hola\" ya", cursor: 7, keys: "ci\"adiós⎋").text == "dice \"adiós\" ya")
        #expect(run("uno dos tres", cursor: 5, keys: "daw").text == "uno tres")
        #expect(run("uno dos tres", cursor: 5, keys: "ciwDOS⎋").text == "uno DOS tres")
    }

    @Test func insertCommandsAndDotRepeat() {
        #expect(run("medio", keys: "Iini ⎋Afin⎋").text == "ini mediofin")
        #expect(run("uno\ntres", keys: "odos⎋").text == "uno\ndos\ntres")
        #expect(run("- a\n- b\n- c", keys: "A!⎋j.j.").text == "- a!\n- b!\n- c!")
        #expect(run("a b c d", keys: "dw..").text == "d")
        #expect(run("xxxx", keys: "x3.").text == "")
    }

    @Test func visualMode() {
        #expect(run("hola mundo", keys: "veyP").text == "holahola mundo")
        #expect(run("hola mundo", keys: "vld").text == "la mundo")
        #expect(run("uno\ndos\ntres", keys: "Vjd").text == "tres")
        #expect(run("uno dos", cursor: 4, keys: "viwy$p").text == "uno dosdos")
        #expect(run("abc", keys: "v$~").text == "ABC")
    }

    @Test func findReplaceJoinAndIndent() {
        #expect(run("a,b,c", keys: "f,;").cursor == 3)
        #expect(run("hola mundo", keys: "dtm").text == "mundo")
        #expect(run("gato", keys: "rp").text == "pato")
        #expect(run("uno\n  dos", keys: "J").text == "uno dos")
        #expect(run("- item", keys: ">>").text == "    - item")
        #expect(run("    - item", keys: "<<").text == "- item")
        #expect(run("(a [b] c)", keys: "%").cursor == 8)
    }

    @Test func paragraphMotions() {
        let text = "uno\ndos\n\ntres\n\ncuatro"
        #expect(run(text, keys: "}").cursor == 8)
        #expect(run(text, keys: "}}").cursor == 14)
        #expect(run(text, cursor: 15, keys: "{").cursor == 14)
        #expect(run(text, keys: "dap").text == "tres\n\ncuatro")
    }

    @Test func modesAndCommandLine() {
        _ = run("uno\ndos\ntres", keys: "i")
        #expect(engine.mode == .insert)
        _ = engine.handle(VimEngine.escape)
        #expect(engine.mode == .normal)
        #expect(run("uno\ndos\ntres", keys: ":3⏎").cursor == 8)
        #expect(engine.mode == .normal)
        #expect(!engine.handle("x", control: true))
        _ = run("abc", keys: ":w")
        #expect(engine.mode == .command("w"))
        _ = engine.handle(VimEngine.escape)
        #expect(engine.mode == .normal)
    }

    @Test func cursorNeverRestsOnTheLineBreak() {
        #expect(run("abc\ndef", keys: "$").cursor == 2)
        #expect(run("abc\ndef", keys: "Afin⎋").cursor == 5)
        #expect(run("abc\n\ndef", keys: "j").cursor == 4)
    }
}

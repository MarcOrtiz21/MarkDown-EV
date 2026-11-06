import Observation
import SwiftUI

/// First visible source line of the document. Lives in its own object so that
/// scrolling only invalidates the views that read it (the outline), not the window.
@MainActor
@Observable
final class ReadingPosition {
    var line = 0

    func update(_ newLine: Int) {
        if line != newLine { line = newLine }
    }
}

struct OutlineSidebar: View {
    let headings: [OutlineHeading]
    let position: ReadingPosition
    let onSelect: (OutlineHeading) -> Void

    @Namespace private var indicator

    private var activeID: OutlineHeading.ID? {
        MarkdownText.activeHeading(in: headings, atLine: position.line)?.id
    }

    var body: some View {
        if headings.isEmpty {
            ContentUnavailableView(
                "Sin encabezados",
                systemImage: "list.bullet.indent",
                description: Text("Los títulos que empiecen por # aparecerán aquí.")
            )
        } else {
            let activeID = activeID
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(headings.enumerated()), id: \.element.id) { index, heading in
                            OutlineRow(
                                heading: heading,
                                isActive: heading.id == activeID,
                                isFirst: index == 0,
                                isLast: index == headings.count - 1,
                                indicator: indicator
                            )
                            .id(heading.id)
                            .onTapGesture { onSelect(heading) }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .animation(.spring(duration: 0.35, bounce: 0.2), value: activeID)
                }
                .onChange(of: activeID) { _, id in
                    guard let id else { return }
                    withAnimation(.easeInOut(duration: 0.25)) {
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
            }
        }
    }
}

private struct OutlineRow: View {
    let heading: OutlineHeading
    let isActive: Bool
    let isFirst: Bool
    let isLast: Bool
    let indicator: Namespace.ID

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            rail
            Text(heading.title)
                .font(heading.level == 1 ? .body.weight(.semibold) : .body)
                .fontWeight(isActive ? .semibold : nil)
                .foregroundStyle(isActive ? .primary : .secondary)
                .lineLimit(2)
                .padding(.leading, CGFloat(min(heading.level, 4) - 1) * 12)
                .padding(.vertical, 5)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .background(alignment: .trailing) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(.quaternary)
                .opacity(isHovered ? 1 : 0)
                .padding(.leading, 20)
        }
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    /// A continuous vertical line through every row; the active row carries the dot.
    private var rail: some View {
        ZStack {
            VStack(spacing: 0) {
                Rectangle().opacity(isFirst ? 0 : 1)
                Rectangle().opacity(isLast ? 0 : 1)
            }
            .frame(width: 1.5)
            .foregroundStyle(.separator)

            Circle()
                .fill(.quaternary)
                .frame(width: 5, height: 5)

            if isActive {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 9, height: 9)
                    .shadow(color: Color.accentColor.opacity(0.5), radius: 4)
                    .matchedGeometryEffect(id: "reading-indicator", in: indicator)
            }
        }
        .frame(width: 12)
    }
}

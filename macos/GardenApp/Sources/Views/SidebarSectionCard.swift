import AppKit
import SwiftUI

struct SidebarSectionCard<Content: View>: View {
  let title: String
  let subtitle: String?
  @ViewBuilder var content: Content

  init(
    title: String,
    subtitle: String? = nil,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.subtitle = subtitle
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text(title)
          .font(.headline)

        Spacer()

        if let subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }

      content
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(backgroundShape.fill(Color(nsColor: .controlBackgroundColor).opacity(0.4)))
    .overlay(backgroundShape.strokeBorder(Color.primary.opacity(0.08)))
  }

  private var backgroundShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: 12, style: .continuous)
  }
}

import AppKit
import Observation
import SwiftUI

struct GardenMenuBarView: View {
  @Bindable var model: GardenViewModel
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header

      Divider()

      if let errorMessage = model.attentionErrorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
      }

      if model.isLoadingAttention && model.today == nil && model.attentionItems.isEmpty {
        VStack(spacing: 10) {
          ProgressView()
          Text("Loading Garden...")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
      } else if model.attentionItems.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("No open attention.")
            .font(.subheadline.weight(.semibold))
          Text("Garden is quiet right now.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(14)
      } else {
        VStack(alignment: .leading, spacing: 4) {
          ForEach(model.menuBarItems) { item in
            MenuBarAttentionRow(
              item: item,
              isBusy: model.isBusy,
              onOpen: {
                model.selectAttentionItem(id: item.id)
                openWindow(id: "main")
                NSApp.activate(ignoringOtherApps: true)
              },
              onResolve: {
                Task {
                  await model.resolveAttentionItem(id: item.id)
                }
              }
            )
          }
        }
        .padding(10)
      }

      Divider()

      footer
    }
    .frame(width: 340)
  }

  private var header: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Garden")
          .font(.headline)

        Text("\(model.actionableCount) actionable • \(model.infoCount) info")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Spacer()

      Button {
        Task {
          await model.load()
        }
      } label: {
        Image(systemName: "arrow.clockwise")
      }
      .buttonStyle(.borderless)
      .disabled(model.isBusy)
      .help("Refresh")
    }
    .padding(14)
  }

  private var footer: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Button("Open Garden") {
          openWindow(id: "main")
          NSApp.activate(ignoringOtherApps: true)
        }
        .keyboardShortcut("o")

        Spacer()

        Button("Quit") {
          NSApplication.shared.terminate(nil)
        }
      }

      if let lastUpdatedLabel = model.lastUpdatedLabel {
        Text("Updated \(lastUpdatedLabel)")
          .font(.caption2)
          .foregroundStyle(.tertiary)
      }

      if let workflowErrorMessage = model.workflowErrorMessage {
        Text(workflowErrorMessage)
          .font(.caption2)
          .foregroundStyle(.orange)
          .lineLimit(2)
      }
    }
    .padding(14)
  }
}

private struct MenuBarAttentionRow: View {
  let item: AttentionItem
  let isBusy: Bool
  let onOpen: () -> Void
  let onResolve: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Button(action: onOpen) {
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: item.priority.systemImage)
            .foregroundStyle(item.priority.tint)
            .frame(width: 14)

          VStack(alignment: .leading, spacing: 2) {
            Text(GardenPresentation.shortMenuLabel(item.title))
              .lineLimit(1)

            Text(GardenPresentation.shortMenuLabel(item.sidebarMetadataLine))
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }

          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      Button(action: onResolve) {
        Image(systemName: "checkmark.circle")
      }
      .buttonStyle(.borderless)
      .disabled(isBusy)
      .help("Resolve")
    }
    .padding(.vertical, 4)
  }
}

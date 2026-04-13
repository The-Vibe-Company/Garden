import SwiftUI

struct AttentionDetailView: View {
  let item: AttentionItem?
  let errorMessage: String?
  let isLoading: Bool
  @Binding var snoozeUntil: Date
  let isBusy: Bool
  let onResolve: () -> Void
  let onSnooze: () -> Void

  var body: some View {
    Group {
      if let item {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            header(for: item)
            actionGuidance(for: item)
            actionControls(for: item)
            overview(for: item)
            bodySection(for: item)
            metadataSection(for: item)
          }
          .padding(24)
          .frame(maxWidth: 760, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else if let errorMessage {
        ContentUnavailableView(
          "Garden Unavailable",
          systemImage: "exclamationmark.triangle",
          description: Text(errorMessage)
        )
      } else if isLoading {
        VStack {
          Spacer()
          ProgressView("Loading Garden...")
          Spacer()
        }
      } else {
        ContentUnavailableView(
          "No Attention Selected",
          systemImage: "sidebar.right",
          description: Text("Select an attention item to inspect it and decide what to do next.")
        )
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private func header(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(item.title)
        .font(.title2.weight(.semibold))

      HStack(spacing: 8) {
        DetailBadge(label: item.classificationLabel, tint: item.requiresAction ? .orange : .secondary)
        DetailBadge(label: item.priority.rawValue.capitalized, tint: item.priority.tint)
        Text(item.type)
          .font(.callout)
          .foregroundStyle(.secondary)
      }

      Text(item.sidebarMetadataLine)
        .font(.callout)
        .foregroundStyle(.secondary)
    }
  }

  private func actionGuidance(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(item.classificationDescription)
        .font(.headline)

      Text(item.recommendedNextStep)
        .foregroundStyle(.secondary)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.accentColor.opacity(0.07))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }

  private func actionControls(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Actions")
        .font(.headline)

      HStack(spacing: 10) {
        Button(item.primaryActionLabel, action: onResolve)
          .disabled(isBusy)

        if item.requiresAction {
          Button("Snooze", action: onSnooze)
            .disabled(isBusy)

          DatePicker(
            "Until",
            selection: $snoozeUntil,
            displayedComponents: [.date, .hourAndMinute]
          )
          .datePickerStyle(.field)
          .labelsHidden()
          .frame(maxWidth: 220)
          .disabled(isBusy)
        }
      }
    }
  }

  private func overview(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Overview")
        .font(.headline)

      Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
        overviewRow(label: "Type", value: item.type)
        overviewRow(label: "Priority", value: item.priority.rawValue)
        overviewRow(label: "Status", value: item.status.rawValue)
        overviewRow(label: "Needs Action", value: item.requiresAction ? "yes" : "no")
        overviewRow(label: "Source", value: item.source ?? "—")
        overviewRow(label: "Due", value: GardenFormatting.timestamp(item.dueAt) ?? "—")
        overviewRow(label: "Snoozed Until", value: GardenFormatting.timestamp(item.snoozedUntil) ?? "—")
        overviewRow(label: "Created", value: GardenFormatting.timestamp(item.createdAt) ?? "—")
        overviewRow(label: "Updated", value: GardenFormatting.timestamp(item.updatedAt) ?? "—")
      }
    }
  }

  private func overviewRow(label: String, value: String) -> some View {
    GridRow {
      Text(label)
        .foregroundStyle(.secondary)
      Text(value)
        .textSelection(.enabled)
    }
  }

  private func bodySection(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Body")
        .font(.headline)

      if let body = item.body, !body.isEmpty {
        Text(body)
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      } else {
        Text("No body attached.")
          .foregroundStyle(.secondary)
      }
    }
  }

  private func metadataSection(for item: AttentionItem) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Metadata")
        .font(.headline)

      Text(item.metadata.prettyPrintedJSONString)
        .font(.system(.body, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
  }
}

private struct DetailBadge: View {
  let label: String
  let tint: Color

  var body: some View {
    Text(label)
      .font(.caption.weight(.semibold))
      .foregroundStyle(tint)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(tint.opacity(0.12))
      .clipShape(Capsule())
  }
}

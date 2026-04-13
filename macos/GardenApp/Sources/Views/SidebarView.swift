import Observation
import SwiftUI

struct SidebarView: View {
  @Bindable var model: GardenViewModel

  var body: some View {
    VStack(spacing: 0) {
      SidebarSummaryView(
        actionableCount: model.actionableCount,
        infoCount: model.infoCount,
        lastUpdatedLabel: model.lastUpdatedLabel,
        contextSummary: model.gardenContextSummary
      )

      List {
        attentionSection(
          title: "Action Needed",
          items: model.actionableItems,
          emptyText: "Nothing needs action right now."
        )

        attentionSection(
          title: "Information",
          items: model.informationalItems,
          emptyText: "No informational items right now."
        )

        workflowSection
      }
      .listStyle(.sidebar)
    }
  }

  @ViewBuilder
  private func attentionSection(
    title: String,
    items: [AttentionItem],
    emptyText: String
  ) -> some View {
    Section(title) {
      if items.isEmpty {
        Text(emptyText)
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        ForEach(items) { item in
          AttentionSidebarRow(
            item: item,
            isSelected: model.selectedAttentionID == item.id
          )
          .contentShape(Rectangle())
          .onTapGesture {
            model.selectAttentionItem(id: item.id)
          }
        }
      }
    }
  }

  @ViewBuilder
  private var workflowSection: some View {
    Section("Workflow") {
      if let activity = model.workflowPanelActivity {
        WorkflowSidebarRow(
          activity: activity,
          workflowSummary: model.workflowDetailSummary,
          isSelected: model.displayedDetailSelection == .workflowRun
        )
        .contentShape(Rectangle())
        .onTapGesture {
          model.showWorkflowDetail()
        }
      } else if let workflowAvailabilityMessage = model.workflowAvailabilityMessage {
        Text(workflowAvailabilityMessage)
          .font(.caption)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      } else if let workflow = model.currentWorkflowSummary {
        VStack(alignment: .leading, spacing: 4) {
          Text(workflow.description ?? workflow.id)
            .font(.subheadline)
            .lineLimit(1)

          Text("No recent run selected.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .onTapGesture {
          model.showWorkflowDetail()
        }
      } else {
        Text("No workflow selected.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

private struct SidebarSummaryView: View {
  let actionableCount: Int
  let infoCount: Int
  let lastUpdatedLabel: String?
  let contextSummary: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text("Today")
          .font(.headline)

        Spacer(minLength: 0)

        Text(summaryLine)
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      if let lastUpdatedLabel {
        Text("Updated \(lastUpdatedLabel)")
          .font(.caption2)
          .foregroundStyle(.tertiary)
      }

      if let contextSummary {
        Text(contextSummary)
          .font(.caption2)
          .foregroundStyle(.tertiary)
          .lineLimit(2)
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, 12)
    .padding(.bottom, 8)
  }

  private var summaryLine: String {
    "\(actionableCount) action needed • \(infoCount) info"
  }
}

private struct AttentionSidebarRow: View {
  let item: AttentionItem
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: item.priority.systemImage)
        .foregroundStyle(item.priority.tint)
        .frame(width: 16)

      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
          .lineLimit(1)

        Text(item.sidebarMetadataLine)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 6)
    .background(isSelected ? Color.accentColor.opacity(0.14) : .clear)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

private struct WorkflowSidebarRow: View {
  let activity: WorkflowActivity
  let workflowSummary: WorkflowSummary?
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: statusImage)
        .foregroundStyle(statusColor)
        .frame(width: 16)

      VStack(alignment: .leading, spacing: 2) {
        Text(workflowSummary?.description ?? activity.displayName)
          .lineLimit(1)

        Text(activity.message)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 6)
    .background(isSelected ? Color.accentColor.opacity(0.14) : .clear)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }

  private var statusImage: String {
    switch activity.state {
    case .running:
      return "clock.arrow.circlepath"
    case .success:
      return "checkmark.circle"
    case .failed:
      return "xmark.octagon"
    case .skipped:
      return "arrow.triangle.2.circlepath.circle"
    }
  }

  private var statusColor: Color {
    switch activity.state {
    case .running:
      return .blue
    case .success:
      return .green
    case .failed:
      return .red
    case .skipped:
      return .orange
    }
  }
}

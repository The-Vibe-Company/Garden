import SwiftUI

struct WorkflowRunDetailView: View {
  let activity: WorkflowActivity?
  let workflowSummary: WorkflowSummary?
  let workflowAvailabilityMessage: String?
  let gardenStatus: GardenStatusSummary?

  var body: some View {
    Group {
      if let activity {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            header(for: activity)
            overview(for: activity)

            if let workflowSummary {
              workflowDefinition(for: workflowSummary)
            }

            logSection(for: activity)
            contextSection
          }
          .padding(24)
          .frame(maxWidth: 760, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else if let workflowAvailabilityMessage {
        ContentUnavailableView(
          "Workflows Unavailable",
          systemImage: "bolt.slash",
          description: Text(workflowAvailabilityMessage)
        )
      } else if let workflowSummary {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
              Text(workflowSummary.description ?? workflowSummary.id)
                .font(.title2.weight(.semibold))

              Text("No recent run is selected.")
                .foregroundStyle(.secondary)
            }

            workflowDefinition(for: workflowSummary)
            contextSection
          }
          .padding(24)
          .frame(maxWidth: 760, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else {
        ContentUnavailableView(
          "No Workflow Selected",
          systemImage: "bolt.horizontal.circle",
          description: Text("Run a workflow or inspect the latest run from the sidebar.")
        )
      }
    }
  }

  private func header(for activity: WorkflowActivity) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(activity.displayName)
        .font(.title2.weight(.semibold))

      Text(statusLine(for: activity))
        .font(.callout)
        .foregroundStyle(.secondary)

      Text(activity.message)
        .textSelection(.enabled)
    }
  }

  private func overview(for activity: WorkflowActivity) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Run Overview")
        .font(.headline)

      Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
        detailRow(label: "Workflow", value: activity.workflowID)
        detailRow(label: "Status", value: activity.state.rawValue)
        detailRow(label: "Started", value: GardenFormatting.timestamp(activity.startedAt) ?? "—")
        detailRow(label: "Finished", value: GardenFormatting.timestamp(activity.completedAt) ?? "—")
        detailRow(label: "Current Step", value: activity.currentStep ?? "—")
      }
    }
  }

  private func workflowDefinition(for workflowSummary: WorkflowSummary) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Workflow")
        .font(.headline)

      Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
        detailRow(label: "Identifier", value: workflowSummary.id)
        detailRow(label: "Description", value: workflowSummary.description ?? "—")
        detailRow(label: "Triggers", value: GardenFormatting.workflowTriggerSummary(for: workflowSummary))
        detailRow(label: "Manual Run", value: workflowSummary.canRunManually ? "yes" : "no")
      }
    }
  }

  private func logSection(for activity: WorkflowActivity) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Run Log")
        .font(.headline)

      if activity.consoleEntries.isEmpty {
        Text("No log lines were captured for this run.")
          .foregroundStyle(.secondary)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(activity.consoleEntries) { entry in
              Text(consoleLine(for: entry))
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(consoleColor(for: entry.source))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 180, maxHeight: .infinity, alignment: .top)
        .padding(12)
        .background(Color.primary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    }
  }

  private var contextSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Garden Context")
        .font(.headline)

      if let gardenStatus {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
          detailRow(label: "CLI", value: GardenFormatting.compactPath(gardenStatus.cliPath) ?? gardenStatus.cliPath)
          detailRow(label: "Config", value: GardenFormatting.compactPath(gardenStatus.configPath) ?? gardenStatus.configPath)
          detailRow(label: "Database", value: GardenFormatting.compactPath(gardenStatus.dbPath) ?? gardenStatus.dbPath)
        }
      } else {
        Text("Garden context has not loaded yet.")
          .foregroundStyle(.secondary)
      }
    }
  }

  private func detailRow(label: String, value: String) -> some View {
    GridRow {
      Text(label)
        .foregroundStyle(.secondary)
      Text(value)
        .textSelection(.enabled)
    }
  }

  private func statusLine(for activity: WorkflowActivity) -> String {
    let fragments = [
      activity.state.rawValue,
      GardenFormatting.timestamp(activity.completedAt ?? activity.startedAt)
    ].compactMap { $0 }

    return fragments.joined(separator: " • ")
  }

  private func consoleLine(for entry: WorkflowConsoleEntry) -> String {
    let prefix: String
    switch entry.source {
    case .system:
      prefix = "sys"
    case .stdout:
      prefix = "out"
    case .stderr:
      prefix = "err"
    case .finalMessage:
      prefix = "fin"
    }

    return "\(prefix) \(entry.text)"
  }

  private func consoleColor(for source: WorkflowConsoleSource) -> Color {
    switch source {
    case .system:
      return .secondary
    case .stdout:
      return .primary
    case .stderr:
      return .orange
    case .finalMessage:
      return .blue
    }
  }
}

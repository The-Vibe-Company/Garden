import Foundation
import SwiftUI

enum GardenFormatting {
  private static let dateTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter
  }()

  static func timestamp(_ date: Date?) -> String? {
    guard let date else {
      return nil
    }

    return dateTimeFormatter.string(from: date)
  }

  static func attentionTimingLabel(for item: AttentionItem) -> String? {
    if let snoozedUntil = item.snoozedUntil, let label = timestamp(snoozedUntil) {
      return "snoozed until \(label)"
    }

    if let dueAt = item.dueAt, let label = timestamp(dueAt) {
      return "due \(label)"
    }

    return nil
  }

  static func workflowTriggerSummary(for workflow: WorkflowSummary) -> String {
    let scheduleLabels = workflow.scheduleCrons.map { "schedule \($0)" }
    let webhookLabels = workflow.webhookEvents.map { "webhook \($0)" }
    let summary = (scheduleLabels + webhookLabels).joined(separator: " • ")
    return summary.isEmpty ? "manual only" : summary
  }

  static func compactPath(_ path: String?) -> String? {
    guard let path, !path.isEmpty else {
      return nil
    }

    let homePath = FileManager.default.homeDirectoryForCurrentUser.path
    if path == homePath {
      return "~"
    }
    if path.hasPrefix(homePath + "/") {
      return "~/" + path.dropFirst(homePath.count + 1)
    }

    return path
  }
}

extension AttentionPriority {
  var tint: Color {
    switch self {
    case .low:
      return .secondary
    case .medium:
      return .blue
    case .high:
      return .orange
    case .urgent:
      return .red
    }
  }

  var systemImage: String {
    switch self {
    case .low:
      return "arrow.down.circle"
    case .medium:
      return "circle"
    case .high:
      return "exclamationmark.circle"
    case .urgent:
      return "exclamationmark.triangle.fill"
    }
  }
}

extension AttentionItem {
  var requiresAction: Bool {
    type != "info"
  }

  var classificationLabel: String {
    requiresAction ? "Action Needed" : "Information"
  }

  var classificationDescription: String {
    switch type {
    case "reply_needed":
      return "A reply or direct follow-up is expected."
    case "review_needed":
      return "Something needs to be reviewed before you can move on."
    case "failed_run":
      return "A workflow failed and needs human attention."
    case "info":
      return "This is informational. No immediate action is required."
    default:
      return requiresAction ? "This item expects a human decision or follow-up." : "This item is informational."
    }
  }

  var recommendedNextStep: String {
    switch type {
    case "reply_needed":
      return "Reply or capture the answer, then mark this item done."
    case "review_needed":
      return "Review the output, transcript, or artifact, then mark this item done."
    case "failed_run":
      return "Inspect the failure, rerun if needed, then mark this item done."
    case "info":
      return "Read it if useful, then archive it when it no longer matters."
    default:
      return requiresAction ? "Handle the task, then mark it done." : "Keep it for reference or archive it later."
    }
  }

  var primaryActionLabel: String {
    requiresAction ? "Mark Done" : "Archive Info"
  }

  var sidebarMetadataLine: String {
    let fragments = [
      priority.rawValue,
      type,
      source,
      GardenFormatting.attentionTimingLabel(for: self)
    ]
      .compactMap { value -> String? in
        guard let value, !value.isEmpty else {
          return nil
        }

        return value
      }

    return fragments.isEmpty ? "open" : fragments.joined(separator: " • ")
  }
}

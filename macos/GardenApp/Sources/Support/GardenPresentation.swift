import Foundation

enum GardenPresentation {
  static func menuBarTitle(openAttentionCount: Int) -> String {
    switch openAttentionCount {
    case 0:
      return "Garden"
    case 1...9:
      return "Garden \(openAttentionCount)"
    default:
      return "Garden 9+"
    }
  }

  static func menuBarSystemImage(
    actionableCount: Int,
    infoCount: Int,
    hasError: Bool,
    isWorkflowRunning: Bool
  ) -> String {
    if hasError {
      return "exclamationmark.triangle.fill"
    }

    if isWorkflowRunning {
      return "clock.arrow.circlepath"
    }

    if actionableCount > 0 {
      return "bell.badge.fill"
    }

    if infoCount > 0 {
      return "bell"
    }

    return "checkmark.circle"
  }

  static func shortMenuLabel(_ value: String, limit: Int = 30) -> String {
    if value.count <= limit {
      return value
    }

    return String(value.prefix(max(0, limit - 3))) + "..."
  }

  static func workflowActivityMessage(
    workflowName: String,
    latestRun: WorkflowRun?
  ) -> String {
    guard let latestRun else {
      return "Starting \(workflowName)…"
    }

    switch latestRun.status {
    case .running:
      return "Garden is waiting for Codex to finish."
    case .success:
      return "Finishing up \(workflowName)…"
    case .failed:
      return latestRun.summary ?? "\(workflowName) failed."
    }
  }
}

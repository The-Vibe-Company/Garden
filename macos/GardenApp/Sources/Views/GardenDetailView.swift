import SwiftUI

struct GardenDetailView: View {
  let selection: GardenDetailSelection?
  let attentionItem: AttentionItem?
  let attentionErrorMessage: String?
  let workflowActivity: WorkflowActivity?
  let workflowSummary: WorkflowSummary?
  let workflowAvailabilityMessage: String?
  let gardenStatus: GardenStatusSummary?
  let isLoadingAttention: Bool
  @Binding var snoozeUntil: Date
  let isBusy: Bool
  let onResolveAttention: () -> Void
  let onSnoozeAttention: () -> Void

  var body: some View {
    switch selection {
    case .attention:
      AttentionDetailView(
        item: attentionItem,
        errorMessage: attentionErrorMessage,
        isLoading: isLoadingAttention,
        snoozeUntil: $snoozeUntil,
        isBusy: isBusy,
        onResolve: onResolveAttention,
        onSnooze: onSnoozeAttention
      )
    case .workflowRun:
      WorkflowRunDetailView(
        activity: workflowActivity,
        workflowSummary: workflowSummary,
        workflowAvailabilityMessage: workflowAvailabilityMessage,
        gardenStatus: gardenStatus
      )
    case nil:
      if let attentionErrorMessage {
        ContentUnavailableView(
          "Garden Unavailable",
          systemImage: "exclamationmark.triangle",
          description: Text(attentionErrorMessage)
        )
      } else if isLoadingAttention {
        VStack {
          Spacer()
          ProgressView("Loading Garden...")
          Spacer()
        }
      } else {
        ContentUnavailableView(
          "No Selection",
          systemImage: "square.on.square",
          description: Text("Select an attention item or inspect a workflow run.")
        )
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }
}

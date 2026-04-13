import Observation
import SwiftUI

struct ContentView: View {
  @Bindable var model: GardenViewModel

  var body: some View {
    HSplitView {
      SidebarView(model: model)
        .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)

      GardenDetailView(
        selection: model.displayedDetailSelection,
        attentionItem: model.selectedDetailAttentionItem,
        attentionErrorMessage: model.attentionErrorMessage,
        workflowActivity: model.selectedDetailWorkflowActivity,
        workflowSummary: model.workflowDetailSummary,
        workflowAvailabilityMessage: model.workflowAvailabilityMessage,
        gardenStatus: model.gardenStatus,
        isLoadingAttention: model.isLoadingAttention,
        snoozeUntil: $model.snoozeUntil,
        isBusy: model.isBusy,
        onResolveAttention: {
          Task {
            await model.resolveSelectedAttentionItem()
          }
        },
        onSnoozeAttention: {
          Task {
            await model.snoozeSelectedAttentionItem()
          }
        }
      )
      .frame(minWidth: 460, idealWidth: 560, maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(minWidth: 820, minHeight: 560)
    .toolbar {
      ToolbarItem(placement: .automatic) {
        if let workflowActivity = model.workflowActivity {
          HStack(spacing: 8) {
            ProgressView()
              .controlSize(.small)

            Text("Running \(GardenPresentation.shortMenuLabel(workflowActivity.displayName, limit: 22))")
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
      }

      ToolbarItem(placement: .automatic) {
        Menu {
          if let workflowAvailabilityMessage = model.workflowAvailabilityMessage {
            Text(workflowAvailabilityMessage)
          } else if model.workflows.isEmpty {
            Text("No workflows configured.")
          } else {
            Picker("Workflow", selection: $model.selectedWorkflowID) {
              ForEach(model.workflows) { workflow in
                Text(workflow.description ?? workflow.id)
                  .tag(Optional(workflow.id))
              }
            }

            Divider()

            Button("Run Now") {
              Task {
                await model.runSelectedWorkflow()
              }
            }
            .disabled(model.selectedWorkflowID == nil || model.isWorkflowRunning)

            if model.workflowPanelActivity != nil {
              Button("Inspect Latest Run") {
                model.showWorkflowDetail()
              }
            }
          }
        } label: {
          Label("Workflow", systemImage: "bolt")
        }
      }

      ToolbarItem(placement: .primaryAction) {
        Button {
          Task {
            await model.load()
          }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(model.isBusy)
      }

      ToolbarItem(placement: .automatic) {
        if model.isBusy {
          ProgressView()
            .controlSize(.small)
        }
      }
    }
    .task {
      await model.load()
    }
  }
}

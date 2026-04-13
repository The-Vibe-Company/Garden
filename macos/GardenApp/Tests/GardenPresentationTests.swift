import XCTest
@testable import GardenApp

final class GardenPresentationTests: XCTestCase {
  func testMenuBarTitleCompactsLargerCounts() {
    XCTAssertEqual(GardenPresentation.menuBarTitle(openAttentionCount: 0), "Garden")
    XCTAssertEqual(GardenPresentation.menuBarTitle(openAttentionCount: 3), "Garden 3")
    XCTAssertEqual(GardenPresentation.menuBarTitle(openAttentionCount: 14), "Garden 9+")
  }

  func testMenuBarSystemImagePrioritizesErrorThenActionableThenInfo() {
    XCTAssertEqual(
      GardenPresentation.menuBarSystemImage(
        actionableCount: 2,
        infoCount: 1,
        hasError: true,
        isWorkflowRunning: true
      ),
      "exclamationmark.triangle.fill"
    )
    XCTAssertEqual(
      GardenPresentation.menuBarSystemImage(
        actionableCount: 0,
        infoCount: 0,
        hasError: false,
        isWorkflowRunning: true
      ),
      "clock.arrow.circlepath"
    )
    XCTAssertEqual(
      GardenPresentation.menuBarSystemImage(
        actionableCount: 2,
        infoCount: 0,
        hasError: false,
        isWorkflowRunning: false
      ),
      "bell.badge.fill"
    )
    XCTAssertEqual(
      GardenPresentation.menuBarSystemImage(
        actionableCount: 0,
        infoCount: 1,
        hasError: false,
        isWorkflowRunning: false
      ),
      "bell"
    )
    XCTAssertEqual(
      GardenPresentation.menuBarSystemImage(
        actionableCount: 0,
        infoCount: 0,
        hasError: false,
        isWorkflowRunning: false
      ),
      "checkmark.circle"
    )
  }

  func testShortMenuLabelTruncatesAtThirtyCharacters() {
    XCTAssertEqual(
      GardenPresentation.shortMenuLabel("012345678901234567890123456789"),
      "012345678901234567890123456789"
    )
    XCTAssertEqual(
      GardenPresentation.shortMenuLabel("012345678901234567890123456789x"),
      "012345678901234567890123456..."
    )
  }

  func testWorkflowTriggerSummaryFormatsAllTriggers() {
    let workflow = WorkflowSummary(
      id: "ingest",
      description: "Ingest transcript",
      enabled: true,
      canRunManually: true,
      scheduleCrons: ["0 * * * *"],
      webhookEvents: ["transcript.completed"]
    )

    XCTAssertEqual(
      GardenFormatting.workflowTriggerSummary(for: workflow),
      "schedule 0 * * * * • webhook transcript.completed"
    )
  }

  func testWorkflowActivityMessageReflectsObservedRunState() {
    let runningRun = WorkflowRun(
      id: 7,
      workflowId: "vault-garden",
      triggerType: "manual",
      triggerValue: "vault-garden",
      status: .running,
      startedAt: Date(timeIntervalSince1970: 100),
      finishedAt: nil,
      summary: nil,
      details: [:]
    )

    XCTAssertEqual(
      GardenPresentation.workflowActivityMessage(workflowName: "Vault Garden", latestRun: nil),
      "Starting Vault Garden…"
    )
    XCTAssertEqual(
      GardenPresentation.workflowActivityMessage(workflowName: "Vault Garden", latestRun: runningRun),
      "Garden is waiting for Codex to finish."
    )
  }
}

import XCTest
@testable import GardenApp

@MainActor
final class GardenViewModelTests: XCTestCase {
  func testLoadKeepsAttentionVisibleWhenWorkflowsAreUnavailable() async throws {
    let client = MockGardenCLIClient()
    await client.setStatus(
      GardenStatusSummary(
        appName: "Garden",
        appVersion: "0.1.0",
        cliPath: "/Users/stan/Dev/Garden/dist/src/cli.js",
        configPath: "/Users/stan/.garden/config.json",
        configExists: false,
        dbPath: "/Users/stan/.garden/garden.db"
      )
    )
    await client.setTodaySummary(
      TodaySummary(
        generatedAt: Date(timeIntervalSince1970: 75),
        actionable: [attentionItem()],
        info: [],
        recentRuns: []
      )
    )
    await client.setAttentionItems([attentionItem()])

    let model = GardenViewModel(client: client, workflowClient: client)
    await model.load()

    XCTAssertEqual(model.attentionItems.count, 1)
    XCTAssertNotNil(model.today)
    XCTAssertEqual(model.selectedDetailAttentionItem?.id, 1)
    XCTAssertNil(model.attentionErrorMessage)
    XCTAssertTrue(model.workflowAvailabilityMessage?.contains("No Garden config found") == true)
  }

  func testRunSelectedWorkflowRetainsFailureDetails() async throws {
    let client = MockGardenCLIClient()
    let workflowClient = MockGardenCLIClient()
    await workflowClient.setWorkflows([workflowSummary()])
    await workflowClient.setWorkflowStreamError(GardenCLIClientError.nodeUnavailable)
    await workflowClient.setStatus(gardenStatus())

    let model = GardenViewModel(client: client, workflowClient: workflowClient)
    model.workflows = [workflowSummary()]
    model.selectedWorkflowID = "vault-garden"

    await model.runSelectedWorkflow()
    try await waitUntil {
      model.workflowPanelActivity?.state == .failed
    }

    XCTAssertFalse(model.isWorkflowRunning)
    XCTAssertEqual(model.workflowPanelActivity?.workflowID, "vault-garden")
    XCTAssertEqual(model.workflowPanelActivity?.state, .failed)
    XCTAssertEqual(model.statusMessage, GardenCLIClientError.nodeUnavailable.errorDescription)
    XCTAssertTrue(
      model.workflowPanelActivity?.consoleEntries.contains {
        $0.text.contains("Node.js was not found")
      } == true
    )
  }

  func testRunSelectedWorkflowRetainsSuccessfulStreamOutput() async throws {
    let workflow = workflowSummary()
    let run = workflowRun(status: .success, summary: "Garden pass completed.")
    let startedAt = run.startedAt
    let completedAt = run.finishedAt ?? Date()

    let workflowClient = MockGardenCLIClient()
    await workflowClient.setWorkflows([workflow])
    await workflowClient.setStatus(gardenStatus())
    await workflowClient.setWorkflowStreamEvents([
      workflowEvent(type: .runStarted, run: run, at: startedAt),
      workflowEvent(type: .codexStdout, runId: run.id, text: "planning garden pass", stepIndex: 0, at: startedAt),
      workflowEvent(type: .codexFinalMessage, runId: run.id, text: "finished cleanly", stepIndex: 0, at: completedAt),
      workflowEvent(type: .runCompleted, run: run, at: completedAt)
    ])
    await workflowClient.setWorkflowRunResult(WorkflowRunCommandResult(skipped: false, run: run))

    let model = GardenViewModel(client: workflowClient, workflowClient: workflowClient)
    model.workflows = [workflow]
    model.selectedWorkflowID = run.workflowId

    await model.runSelectedWorkflow()
    try await waitUntil {
      model.workflowPanelActivity?.state == .success
    }

    let activity = try XCTUnwrap(model.workflowPanelActivity)
    XCTAssertFalse(model.isWorkflowRunning)
    XCTAssertEqual(activity.state, .success)
    XCTAssertEqual(activity.message, "Garden pass completed.")
    XCTAssertNotNil(activity.completedAt)
    XCTAssertTrue(activity.consoleEntries.contains { $0.text.contains("planning garden pass") })
    XCTAssertTrue(activity.consoleEntries.contains { $0.text.contains("finished cleanly") })
  }

  func testActionFailureDoesNotClearRunningWorkflowState() async throws {
    let regularClient = MockGardenCLIClient()
    await regularClient.setAttentionItems([attentionItem()])
    await regularClient.setStatus(gardenStatus())
    await regularClient.setResolveError(GardenCLIClientError.commandFailed(
      command: "garden attention resolve 1",
      exitCode: 1,
      stderr: "resolve failed",
      stdout: ""
    ))

    let workflowClient = MockGardenCLIClient()
    await workflowClient.setWorkflows([workflowSummary()])
    await workflowClient.setStatus(gardenStatus())
    await workflowClient.setWorkflowStreamEvents([
      workflowEvent(type: .runStarted, at: Date()),
      workflowEvent(type: .stepStarted, runId: 9, stepType: "codex.exec", stepIndex: 0, at: Date())
    ])
    await workflowClient.setWorkflowRunDelay(nanoseconds: 400_000_000)
    await workflowClient.setWorkflowRunResult(
      WorkflowRunCommandResult(skipped: false, run: workflowRun(status: .success, summary: "Done."))
    )

    let model = GardenViewModel(client: regularClient, workflowClient: workflowClient)
    model.attentionItems = [attentionItem()]
    model.selectAttentionItem(id: 1)
    model.workflows = [workflowSummary()]
    model.selectedWorkflowID = "vault-garden"

    await model.runSelectedWorkflow()
    try await waitUntil {
      model.isWorkflowRunning
    }

    await model.resolveSelectedAttentionItem()

    XCTAssertTrue(model.isWorkflowRunning)
    XCTAssertEqual(model.attentionErrorMessage, "resolve failed")

    try await waitUntil {
      model.workflowPanelActivity?.state == .success
    }
    XCTAssertEqual(model.workflowPanelActivity?.message, "Done.")
  }

  private func waitUntil(
    timeoutNanoseconds: UInt64 = 1_500_000_000,
    pollNanoseconds: UInt64 = 25_000_000,
    condition: @escaping @MainActor () -> Bool
  ) async throws {
    let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
    while DispatchTime.now().uptimeNanoseconds < deadline {
      if condition() {
        return
      }
      try await Task.sleep(nanoseconds: pollNanoseconds)
    }

    XCTFail("Condition was not met before timeout.")
  }
}

private actor MockGardenCLIClient: GardenCLIProviding {
  private var statusSummary = gardenStatus()
  private var todaySummary = TodaySummary(
    generatedAt: Date(timeIntervalSince1970: 0),
    actionable: [],
    info: [],
    recentRuns: []
  )
  private var attentionItems: [AttentionItem] = []
  private var workflows: [WorkflowSummary] = []
  private var workflowRunResult = WorkflowRunCommandResult(
    skipped: false,
    run: workflowRun(status: .success, summary: "Finished.")
  )
  private var workflowListError: Error?
  private var workflowStreamEvents: [WorkflowStreamEvent] = []
  private var workflowStreamError: Error?
  private var workflowRunDelayNanoseconds: UInt64 = 0
  private var resolveError: Error?

  func setStatus(_ status: GardenStatusSummary) {
    self.statusSummary = status
  }

  func setWorkflows(_ workflows: [WorkflowSummary]) {
    self.workflows = workflows
  }

  func setTodaySummary(_ summary: TodaySummary) {
    self.todaySummary = summary
  }

  func setAttentionItems(_ items: [AttentionItem]) {
    self.attentionItems = items
  }

  func setWorkflowRunResult(_ result: WorkflowRunCommandResult) {
    self.workflowRunResult = result
  }

  func setWorkflowListError(_ error: Error) {
    self.workflowListError = error
  }

  func setWorkflowStreamEvents(_ events: [WorkflowStreamEvent]) {
    self.workflowStreamEvents = events
  }

  func setWorkflowStreamError(_ error: Error) {
    self.workflowStreamError = error
  }

  func setWorkflowRunDelay(nanoseconds: UInt64) {
    self.workflowRunDelayNanoseconds = nanoseconds
  }

  func setResolveError(_ error: Error) {
    self.resolveError = error
  }

  func status() async throws -> GardenStatusSummary {
    statusSummary
  }

  func today() async throws -> TodaySummary {
    todaySummary
  }

  func attentionList() async throws -> [AttentionItem] {
    attentionItems
  }

  func workflowList() async throws -> [WorkflowSummary] {
    if let workflowListError {
      throw workflowListError
    }
    return workflows
  }

  func resolveAttentionItem(id: Int) async throws {
    if let resolveError {
      throw resolveError
    }
  }

  func snoozeAttentionItem(id: Int, until: Date) async throws {}

  func runWorkflow(id: String) async throws -> WorkflowRunCommandResult {
    workflowRunResult
  }

  func runWorkflowStream(
    id: String,
    onEvent: @escaping @Sendable (WorkflowStreamEvent) async -> Void
  ) async throws -> WorkflowRunCommandResult {
    if let workflowStreamError {
      throw workflowStreamError
    }

    for event in workflowStreamEvents {
      await onEvent(event)
    }

    if workflowRunDelayNanoseconds > 0 {
      try await Task.sleep(nanoseconds: workflowRunDelayNanoseconds)
    }

    return workflowRunResult
  }
}

private func workflowSummary() -> WorkflowSummary {
  WorkflowSummary(
    id: "vault-garden",
    description: "Run a lightweight autonomous garden pass on the Granite vault.",
    enabled: true,
    canRunManually: true,
    scheduleCrons: ["0 */4 * * *"],
    webhookEvents: []
  )
}

private func gardenStatus() -> GardenStatusSummary {
  GardenStatusSummary(
    appName: "Garden",
    appVersion: "0.1.0",
    cliPath: "/Users/stan/Dev/Garden/dist/src/cli.js",
    configPath: "/Users/stan/.garden/config.json",
    configExists: true,
    dbPath: "/Users/stan/.garden/garden.db"
  )
}

private func workflowRun(
  status: WorkflowRunStatus,
  summary: String?
) -> WorkflowRun {
  WorkflowRun(
    id: 9,
    workflowId: "vault-garden",
    triggerType: "manual",
    triggerValue: "vault-garden",
    status: status,
    startedAt: Date(timeIntervalSince1970: 100),
    finishedAt: status == .running ? nil : Date(timeIntervalSince1970: 120),
    summary: summary,
    details: [:]
  )
}

private func workflowEvent(
  type: WorkflowStreamEventType,
  run: WorkflowRun? = nil,
  runId: Int = 9,
  text: String? = nil,
  stepType: String? = nil,
  stepIndex: Int? = nil,
  at: Date
) -> WorkflowStreamEvent {
  WorkflowStreamEvent(
    type: type,
    workflowId: run?.workflowId ?? "vault-garden",
    runId: run?.id ?? runId,
    at: at,
    run: run,
    skipped: type == .runSkipped ? true : nil,
    message: type == .runSkipped ? "Workflow is already running." : nil,
    stepIndex: stepIndex,
    stepType: stepType,
    cwd: "/tmp/garden",
    promptPreview: "Run Codex",
    text: text,
    exitCode: type == .codexCompleted ? 0 : nil,
    ok: type == .codexCompleted ? true : nil
  )
}

private func attentionItem() -> AttentionItem {
  AttentionItem(
    id: 1,
    type: "review_needed",
    title: "Review transcript ingest",
    body: "Check the result.",
    status: .open,
    priority: .medium,
    createdAt: Date(timeIntervalSince1970: 50),
    updatedAt: Date(timeIntervalSince1970: 50),
    dueAt: nil,
    snoozedUntil: nil,
    source: "workflow:test",
    dedupeKey: nil,
    metadata: [:],
    links: []
  )
}

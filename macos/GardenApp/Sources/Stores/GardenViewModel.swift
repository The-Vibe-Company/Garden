import Foundation
import Observation

actor WorkflowEventBuffer {
  private var events: [WorkflowStreamEvent] = []

  func push(_ event: WorkflowStreamEvent) {
    events.append(event)
  }

  func drain() -> [WorkflowStreamEvent] {
    let snapshot = events
    events.removeAll(keepingCapacity: true)
    return snapshot
  }

  func reset() {
    events.removeAll(keepingCapacity: false)
  }
}

@MainActor
@Observable
final class GardenViewModel {
  private let client: any GardenCLIProviding
  private let workflowClient: any GardenCLIProviding
  private let workflowEventBuffer = WorkflowEventBuffer()
  private var workflowRunTask: Task<Void, Never>?
  private var workflowEventDrainTask: Task<Void, Never>?

  var today: TodaySummary?
  var attentionItems: [AttentionItem] = []
  var workflows: [WorkflowSummary] = []
  var gardenStatus: GardenStatusSummary?
  var selectedAttentionID: Int?
  var selectedWorkflowID: String?
  var selectedDetail: GardenDetailSelection?
  var snoozeUntil: Date = Date().addingTimeInterval(60 * 60)
  var isLoadingAttention = false
  var isLoadingWorkflows = false
  var isPerformingAction = false
  var attentionErrorMessage: String?
  var workflowErrorMessage: String?
  var statusMessage: String?
  var runningWorkflowID: String?
  var runningWorkflowStartedAt: Date?
  var runningWorkflowMessage: String?
  var runningWorkflowCurrentStep: String?
  var runningWorkflowConsoleEntries: [WorkflowConsoleEntry] = []
  var lastWorkflowActivity: WorkflowActivity?

  init(
    client: any GardenCLIProviding = GardenCLIClient(),
    workflowClient: any GardenCLIProviding = GardenCLIClient()
  ) {
    self.client = client
    self.workflowClient = workflowClient
  }

  var selectedAttentionItem: AttentionItem? {
    guard let selectedAttentionID else {
      return nil
    }

    return attentionItems.first(where: { $0.id == selectedAttentionID })
  }

  var lastUpdatedLabel: String? {
    GardenFormatting.timestamp(today?.generatedAt)
  }

  var isLoading: Bool {
    isLoadingAttention || isLoadingWorkflows
  }

  var isBusy: Bool {
    isLoading || isPerformingAction
  }

  var isWorkflowRunning: Bool {
    runningWorkflowID != nil
  }

  var openAttentionCount: Int {
    attentionItems.count
  }

  var actionableItems: [AttentionItem] {
    attentionItems.filter(\.requiresAction)
  }

  var informationalItems: [AttentionItem] {
    attentionItems.filter { !$0.requiresAction }
  }

  var actionableCount: Int {
    today?.actionable.count ?? actionableItems.count
  }

  var infoCount: Int {
    today?.info.count ?? informationalItems.count
  }

  var menuBarTitle: String {
    GardenPresentation.menuBarTitle(openAttentionCount: openAttentionCount)
  }

  var menuBarSystemImage: String {
    GardenPresentation.menuBarSystemImage(
      actionableCount: actionableCount,
      infoCount: infoCount,
      hasError: attentionErrorMessage != nil || workflowErrorMessage != nil,
      isWorkflowRunning: isWorkflowRunning
    )
  }

  var menuBarItems: [AttentionItem] {
    Array(attentionItems.prefix(5))
  }

  var currentWorkflowSummary: WorkflowSummary? {
    guard let selectedWorkflowID else {
      return nil
    }

    return workflows.first(where: { $0.id == selectedWorkflowID })
  }

  var workflowActivity: WorkflowActivity? {
    guard let runningWorkflowID else {
      return nil
    }

    return makeWorkflowActivity(
      workflowID: runningWorkflowID,
      message: runningWorkflowMessage ?? "Garden is working…",
      startedAt: runningWorkflowStartedAt,
      completedAt: nil,
      state: .running,
      currentStep: runningWorkflowCurrentStep,
      consoleEntries: runningWorkflowConsoleEntries
    )
  }

  var workflowPanelActivity: WorkflowActivity? {
    workflowActivity ?? lastWorkflowActivity
  }

  var workflowDetailSummary: WorkflowSummary? {
    guard let workflowID = workflowPanelActivity?.workflowID ?? selectedWorkflowID else {
      return nil
    }

    return workflows.first(where: { $0.id == workflowID })
  }

  var displayedDetailSelection: GardenDetailSelection? {
    switch selectedDetail {
    case .attention(let id):
      return attentionItems.contains(where: { $0.id == id }) ? .attention(id) : fallbackDetailSelection
    case .workflowRun:
      return .workflowRun
    case nil:
      return fallbackDetailSelection
    }
  }

  var selectedDetailAttentionItem: AttentionItem? {
    guard case .attention(let id) = displayedDetailSelection else {
      return nil
    }

    return attentionItems.first(where: { $0.id == id })
  }

  var selectedDetailWorkflowActivity: WorkflowActivity? {
    guard displayedDetailSelection == .workflowRun else {
      return nil
    }

    return workflowPanelActivity
  }

  var workflowAvailabilityMessage: String? {
    if let gardenStatus, !gardenStatus.configExists {
      return "No Garden config found at \(GardenFormatting.compactPath(gardenStatus.configPath) ?? gardenStatus.configPath). Run `garden init` to enable workflows."
    }

    return workflowErrorMessage
  }

  var gardenContextSummary: String? {
    guard let gardenStatus else {
      return nil
    }

    let configLabel = GardenFormatting.compactPath(gardenStatus.configPath) ?? gardenStatus.configPath
    let dbLabel = GardenFormatting.compactPath(gardenStatus.dbPath) ?? gardenStatus.dbPath
    return "Config \(configLabel) • DB \(dbLabel)"
  }

  func load() async {
    async let attentionSurface: Void = refreshAttentionSurface(
      showLoading: true,
      clearError: true,
      updateStatusMessage: true
    )
    async let workflowSurface: Void = refreshWorkflowSurface(
      showLoading: true,
      clearError: true
    )
    _ = await (attentionSurface, workflowSurface)
  }

  func selectAttentionItem(id: Int?) {
    selectedAttentionID = id
    selectedDetail = id.map(GardenDetailSelection.attention)
    if let item = selectedAttentionItem {
      snoozeUntil = suggestedSnoozeDate(for: item)
    }
  }

  func showWorkflowDetail() {
    selectedDetail = .workflowRun
  }

  func resolveSelectedAttentionItem() async {
    guard let selectedAttentionItem else {
      return
    }

    let selectedItemID = selectedAttentionItem.id
    await performAttentionAction { [self] in
      try await self.client.resolveAttentionItem(id: selectedItemID)
      await self.refreshAttentionSurface(showLoading: false, clearError: false, updateStatusMessage: false)
      self.statusMessage = "Resolved attention item #\(selectedItemID)."
    }
  }

  func resolveAttentionItem(id: Int) async {
    selectAttentionItem(id: id)
    await resolveSelectedAttentionItem()
  }

  func snoozeSelectedAttentionItem() async {
    guard let selectedAttentionItem else {
      return
    }

    let until = snoozeUntil
    let selectedItemID = selectedAttentionItem.id
    await performAttentionAction { [self] in
      try await self.client.snoozeAttentionItem(id: selectedItemID, until: until)
      await self.refreshAttentionSurface(showLoading: false, clearError: false, updateStatusMessage: false)
      self.statusMessage = "Snoozed attention item #\(selectedItemID) until \(GardenFormatting.timestamp(until) ?? "later")."
    }
  }

  func snoozeAttentionItem(id: Int, until: Date) async {
    selectAttentionItem(id: id)
    snoozeUntil = until
    await snoozeSelectedAttentionItem()
  }

  func runSelectedWorkflow() async {
    guard let selectedWorkflowID else {
      return
    }
    guard !isWorkflowRunning else {
      return
    }

    let workflowID = selectedWorkflowID
    workflowErrorMessage = nil
    showWorkflowDetail()
    startWorkflowActivity(for: workflowID)
    statusMessage = "Started workflow \(workflowID)."

    workflowRunTask?.cancel()
    let workflowClient = self.workflowClient
    let workflowEventBuffer = self.workflowEventBuffer
    workflowRunTask = Task { [weak self] in
      guard let self else {
        return
      }

      do {
        let result = try await workflowClient.runWorkflowStream(id: workflowID) { event in
          await workflowEventBuffer.push(event)
        }
        await self.finishWorkflowRun(workflowID: workflowID, result: result)
      } catch {
        await self.failWorkflowRun(error)
      }
    }
  }

  private func reconcileSelection() {
    if let selectedAttentionID,
       attentionItems.contains(where: { $0.id == selectedAttentionID }) {
      if let item = selectedAttentionItem {
        snoozeUntil = suggestedSnoozeDate(for: item)
      }
    } else {
      selectedAttentionID = attentionItems.first?.id
      if let item = selectedAttentionItem {
        snoozeUntil = suggestedSnoozeDate(for: item)
      }
    }

    if let selectedWorkflowID,
       workflows.contains(where: { $0.id == selectedWorkflowID }) {
      reconcileDetailSelection()
      return
    }

    selectedWorkflowID = workflows.first?.id
    reconcileDetailSelection()
  }

  private func reconcileDetailSelection() {
    switch selectedDetail {
    case .attention(let id):
      if !attentionItems.contains(where: { $0.id == id }) {
        if let selectedAttentionID {
          selectedDetail = .attention(selectedAttentionID)
        } else if workflowPanelActivity != nil {
          selectedDetail = .workflowRun
        } else {
          selectedDetail = nil
        }
      }
    case .workflowRun:
      break
    case nil:
      if let selectedAttentionID {
        selectedDetail = .attention(selectedAttentionID)
      }
    }
  }

  private func performAttentionAction(_ operation: @escaping @MainActor () async throws -> Void) async {
    isPerformingAction = true
    attentionErrorMessage = nil

    do {
      try await operation()
    } catch {
      attentionErrorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    isPerformingAction = false
  }

  private func suggestedSnoozeDate(for item: AttentionItem) -> Date {
    let baseDate = item.dueAt ?? Date()
    return Calendar.current.date(byAdding: .hour, value: 1, to: baseDate) ?? Date().addingTimeInterval(60 * 60)
  }

  private func refreshAttentionSurface(
    showLoading: Bool,
    clearError: Bool,
    updateStatusMessage: Bool
  ) async {
    if showLoading {
      isLoadingAttention = true
    }
    if clearError {
      attentionErrorMessage = nil
    }

    do {
      async let todayValue = client.today()
      async let attentionValue = client.attentionList()

      let (today, attentionItems) = try await (todayValue, attentionValue)
      self.today = today
      self.attentionItems = attentionItems
      reconcileSelection()

      if updateStatusMessage {
        statusMessage = "Updated \(GardenFormatting.timestamp(today.generatedAt) ?? "just now")."
      }
    } catch {
      attentionErrorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    if showLoading {
      isLoadingAttention = false
    }
  }

  private func refreshWorkflowSurface(
    showLoading: Bool,
    clearError: Bool
  ) async {
    if showLoading {
      isLoadingWorkflows = true
    }
    if clearError {
      workflowErrorMessage = nil
    }

    do {
      let gardenStatus = try await client.status()
      self.gardenStatus = gardenStatus

      guard gardenStatus.configExists else {
        workflows = []
        reconcileSelection()
        if showLoading {
          isLoadingWorkflows = false
        }
        return
      }

      workflows = try await client.workflowList()
      reconcileSelection()
    } catch {
      workflowErrorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    if showLoading {
      isLoadingWorkflows = false
    }
  }

  private func startWorkflowActivity(for workflowID: String) {
    lastWorkflowActivity = nil
    selectedDetail = .workflowRun
    runningWorkflowID = workflowID
    runningWorkflowStartedAt = Date()
    runningWorkflowMessage = GardenPresentation.workflowActivityMessage(
      workflowName: workflows.first(where: { $0.id == workflowID })?.description ?? workflowID,
      latestRun: nil
    )
    runningWorkflowCurrentStep = nil
    runningWorkflowConsoleEntries = []
    Task {
      await workflowEventBuffer.reset()
    }
    workflowEventDrainTask?.cancel()
    workflowEventDrainTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(200))
        guard let self else {
          return
        }
        await self.flushWorkflowEvents()
      }
    }
  }

  private func clearRunningWorkflowState() {
    runningWorkflowID = nil
    runningWorkflowStartedAt = nil
    runningWorkflowMessage = nil
    runningWorkflowCurrentStep = nil
    runningWorkflowConsoleEntries = []
    workflowRunTask = nil
    workflowEventDrainTask?.cancel()
    workflowEventDrainTask = nil
    Task {
      await workflowEventBuffer.reset()
    }
  }

  private func finishWorkflowRun(
    workflowID: String,
    result: WorkflowRunCommandResult
  ) async {
    await flushWorkflowEvents()
    await refreshWorkflowSurface(showLoading: false, clearError: false)
    await refreshAttentionSurface(showLoading: false, clearError: false, updateStatusMessage: false)

    let completedAt = result.run.finishedAt ?? Date()
    let activityState: WorkflowActivityState
    let message: String

    if result.skipped {
      activityState = .skipped
      message = result.run.summary ?? "Workflow \(workflowID) is already running."
      statusMessage = message
    } else if result.run.status == .failed {
      activityState = .failed
      message = result.run.summary ?? "Workflow \(workflowID) failed."
      statusMessage = message
    } else {
      activityState = .success
      message = result.run.summary ?? "Workflow \(workflowID) finished successfully."
      statusMessage = message
    }

    runningWorkflowMessage = message
    snapshotWorkflowActivity(state: activityState, completedAt: completedAt)
    clearRunningWorkflowState()
  }

  private func failWorkflowRun(_ error: Error) async {
    await flushWorkflowEvents()
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    let failedAt = Date()
    runningWorkflowMessage = message
    appendWorkflowConsole(source: .stderr, text: message, at: failedAt)
    snapshotWorkflowActivity(state: .failed, completedAt: failedAt)
    clearRunningWorkflowState()
    statusMessage = message
  }

  private func flushWorkflowEvents() async {
    let events = await workflowEventBuffer.drain()
    guard !events.isEmpty else {
      return
    }

    for event in events {
      applyWorkflowStreamEvent(event)
    }
  }

  private func applyWorkflowStreamEvent(_ event: WorkflowStreamEvent) {
    guard runningWorkflowID == event.workflowId else {
      return
    }

    switch event.type {
    case .runStarted:
      runningWorkflowStartedAt = event.run?.startedAt ?? event.at
      runningWorkflowMessage = "Workflow started."
      appendWorkflowConsole(source: .system, text: "Started run #\(event.runId).", at: event.at)

    case .runSkipped:
      runningWorkflowMessage = event.message ?? "Workflow is already running."
      appendWorkflowConsole(source: .system, text: event.message ?? "Workflow is already running.", at: event.at)

    case .stepStarted:
      let stepType = event.stepType ?? "step"
      runningWorkflowCurrentStep = "Step \(stepNumberLabel(event.stepIndex)): \(stepType)"
      runningWorkflowMessage = "Running \(stepType)…"
      appendWorkflowConsole(
        source: .system,
        text: "Started \(stepType) (\(stepNumberLabel(event.stepIndex))).",
        at: event.at
      )

    case .stepCompleted:
      let stepType = event.stepType ?? "step"
      runningWorkflowMessage = "\(stepType) completed."
      appendWorkflowConsole(
        source: .system,
        text: "Completed \(stepType) (\(stepNumberLabel(event.stepIndex))).",
        at: event.at
      )

    case .stepFailed:
      runningWorkflowMessage = event.message ?? "Step failed."
      appendWorkflowConsole(source: .stderr, text: event.message ?? "Step failed.", at: event.at)

    case .codexStarted:
      runningWorkflowCurrentStep = "Codex is running"
      runningWorkflowMessage = "Garden is waiting for Codex to finish."
      appendWorkflowConsole(
        source: .system,
        text: event.cwd.map { "Launching Codex in \($0)." } ?? "Launching Codex.",
        at: event.at
      )

    case .codexStdout:
      appendWorkflowConsole(source: .stdout, text: event.text ?? "", at: event.at)

    case .codexStderr:
      appendWorkflowConsole(source: .stderr, text: event.text ?? "", at: event.at)

    case .codexFinalMessage:
      appendWorkflowConsole(source: .finalMessage, text: event.text ?? "", at: event.at)

    case .codexCompleted:
      runningWorkflowMessage = (event.ok == true) ? "Codex finished." : "Codex failed."
      appendWorkflowConsole(
        source: .system,
        text: (event.ok == true) ? "Codex completed successfully." : "Codex exited with status \(event.exitCode ?? 1).",
        at: event.at
      )

    case .runCompleted:
      runningWorkflowMessage = event.run?.summary ?? "Workflow finished."
      if let run = event.run {
        runningWorkflowStartedAt = run.startedAt
      }
      appendWorkflowConsole(
        source: .system,
        text: event.run?.summary ?? "Workflow finished with status \(event.run?.status.rawValue ?? "unknown").",
        at: event.at
      )
    }
  }

  private func appendWorkflowConsole(
    source: WorkflowConsoleSource,
    text: String,
    at: Date
  ) {
    let fragments = text
      .split(whereSeparator: \.isNewline)
      .map(String.init)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }

    guard !fragments.isEmpty else {
      return
    }

    for fragment in fragments {
      runningWorkflowConsoleEntries.append(
        WorkflowConsoleEntry(source: source, text: fragment, at: at)
      )
    }

    if runningWorkflowConsoleEntries.count > 120 {
      runningWorkflowConsoleEntries.removeFirst(runningWorkflowConsoleEntries.count - 120)
    }
  }

  private func stepNumberLabel(_ stepIndex: Int?) -> String {
    guard let stepIndex else {
      return "?"
    }

    return String(stepIndex + 1)
  }

  private var fallbackDetailSelection: GardenDetailSelection? {
    if let selectedAttentionID {
      return .attention(selectedAttentionID)
    }
    if workflowPanelActivity != nil || workflowErrorMessage != nil || workflowDetailSummary != nil {
      return .workflowRun
    }
    return nil
  }

  private func makeWorkflowActivity(
    workflowID: String,
    message: String,
    startedAt: Date?,
    completedAt: Date?,
    state: WorkflowActivityState,
    currentStep: String?,
    consoleEntries: [WorkflowConsoleEntry]
  ) -> WorkflowActivity {
    let displayName = workflows.first(where: { $0.id == workflowID })?.description ?? workflowID
    return WorkflowActivity(
      workflowID: workflowID,
      displayName: displayName,
      message: message,
      startedAt: startedAt,
      completedAt: completedAt,
      state: state,
      currentStep: currentStep,
      consoleEntries: consoleEntries
    )
  }

  private func snapshotWorkflowActivity(
    state: WorkflowActivityState,
    completedAt: Date
  ) {
    guard let runningWorkflowID else {
      return
    }

    lastWorkflowActivity = makeWorkflowActivity(
      workflowID: runningWorkflowID,
      message: runningWorkflowMessage ?? "Workflow finished.",
      startedAt: runningWorkflowStartedAt,
      completedAt: completedAt,
      state: state,
      currentStep: runningWorkflowCurrentStep,
      consoleEntries: runningWorkflowConsoleEntries
    )
  }
}

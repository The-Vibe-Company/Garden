import Foundation

enum AttentionPriority: String, Codable, CaseIterable, Sendable {
  case low
  case medium
  case high
  case urgent
}

enum AttentionStatus: String, Codable, Sendable {
  case open
  case snoozed
  case done
  case dismissed
}

enum WorkflowRunStatus: String, Codable, Sendable {
  case running
  case success
  case failed
}

struct TodaySummary: Decodable, Sendable {
  let generatedAt: Date
  let actionable: [AttentionItem]
  let info: [AttentionItem]
  let recentRuns: [WorkflowRun]
}

struct AttentionItem: Identifiable, Decodable, Equatable, Sendable {
  let id: Int
  let type: String
  let title: String
  let body: String?
  let status: AttentionStatus
  let priority: AttentionPriority
  let createdAt: Date
  let updatedAt: Date
  let dueAt: Date?
  let snoozedUntil: Date?
  let source: String?
  let dedupeKey: String?
  let metadata: [String: JSONValue]
  let links: [JSONValue]
}

struct WorkflowRun: Identifiable, Decodable, Equatable, Sendable {
  let id: Int
  let workflowId: String
  let triggerType: String
  let triggerValue: String?
  let status: WorkflowRunStatus
  let startedAt: Date
  let finishedAt: Date?
  let summary: String?
  let details: [String: JSONValue]
}

struct WorkflowSummary: Identifiable, Decodable, Equatable, Sendable {
  let id: String
  let description: String?
  let enabled: Bool
  let canRunManually: Bool
  let scheduleCrons: [String]
  let webhookEvents: [String]
}

struct GardenStatusSummary: Decodable, Equatable, Sendable {
  let appName: String
  let appVersion: String
  let cliPath: String
  let configPath: String
  let configExists: Bool
  let dbPath: String
}

struct WorkflowRunCommandResult: Decodable, Sendable {
  let skipped: Bool
  let run: WorkflowRun
}

enum WorkflowStreamEventType: String, Decodable, Sendable {
  case runStarted = "run.started"
  case runSkipped = "run.skipped"
  case stepStarted = "step.started"
  case stepCompleted = "step.completed"
  case stepFailed = "step.failed"
  case codexStarted = "codex.started"
  case codexStdout = "codex.stdout"
  case codexStderr = "codex.stderr"
  case codexFinalMessage = "codex.final_message"
  case codexCompleted = "codex.completed"
  case runCompleted = "run.completed"
}

struct WorkflowStreamEvent: Decodable, Sendable {
  let type: WorkflowStreamEventType
  let workflowId: String
  let runId: Int
  let at: Date
  let run: WorkflowRun?
  let skipped: Bool?
  let message: String?
  let stepIndex: Int?
  let stepType: String?
  let cwd: String?
  let promptPreview: String?
  let text: String?
  let exitCode: Int?
  let ok: Bool?
}

enum WorkflowConsoleSource: String, Sendable {
  case system
  case stdout
  case stderr
  case finalMessage
}

enum WorkflowActivityState: String, Sendable {
  case running
  case success
  case failed
  case skipped
}

struct WorkflowConsoleEntry: Identifiable, Equatable, Sendable {
  let id: UUID
  let source: WorkflowConsoleSource
  let text: String
  let at: Date

  init(
    id: UUID = UUID(),
    source: WorkflowConsoleSource,
    text: String,
    at: Date
  ) {
    self.id = id
    self.source = source
    self.text = text
    self.at = at
  }
}

struct WorkflowActivity: Equatable, Sendable {
  let workflowID: String
  let displayName: String
  let message: String
  let startedAt: Date?
  let completedAt: Date?
  let state: WorkflowActivityState
  let currentStep: String?
  let consoleEntries: [WorkflowConsoleEntry]
}

enum GardenDetailSelection: Equatable, Sendable {
  case attention(Int)
  case workflowRun
}

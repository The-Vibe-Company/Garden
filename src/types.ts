export type JsonRecord = Record<string, unknown>;

export type AttentionPriority = "low" | "medium" | "high" | "urgent";
export type AttentionStatus = "open" | "snoozed" | "done" | "dismissed";
export type WorkflowRunStatus = "running" | "success" | "failed";
export type WorkflowTriggerType = "manual" | "schedule" | "webhook";

export interface AttentionItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  status: AttentionStatus;
  priority: AttentionPriority;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  snoozedUntil: string | null;
  source: string | null;
  dedupeKey: string | null;
  metadata: JsonRecord;
  links: unknown[];
}

export interface AttentionItemInput {
  type: string;
  title: string;
  body?: string | null;
  status?: AttentionStatus;
  priority?: AttentionPriority;
  source?: string | null;
  dedupeKey?: string | null;
  dueAt?: string | null;
  snoozedUntil?: string | null;
  metadata?: JsonRecord;
  links?: unknown[];
}

export interface WorkflowRun {
  id: number;
  workflowId: string;
  triggerType: WorkflowTriggerType;
  triggerValue: string | null;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  details: JsonRecord;
}

export interface TodaySummary {
  generatedAt: string;
  actionable: AttentionItem[];
  info: AttentionItem[];
  recentRuns: WorkflowRun[];
}

export interface EventRecord {
  id: number;
  eventType: string;
  payload: JsonRecord;
  source: string;
  receivedAt: string;
}

export interface WorkflowEvent {
  type: string;
  payload: JsonRecord;
}

export interface ScheduleTrigger {
  type: "schedule";
  cron: string;
}

export interface WebhookTrigger {
  type: "webhook";
  event: string;
}

export type WorkflowTrigger = ScheduleTrigger | WebhookTrigger;

export interface CodexConfig {
  command?: string;
  sandbox?: string;
  profile?: string | null;
  model?: string | null;
  extraArgs?: string[];
}

export interface CodexExecStep {
  type: "codex.exec";
  cwd?: string;
  prompt: string;
  codex?: Partial<CodexConfig>;
}

export interface AttentionCreateStep {
  type: "attention.create";
  attention: JsonRecord;
  notify?: boolean;
}

export interface NotifyMacosStep {
  type: "notify.macos";
  title?: string;
  subtitle?: string;
  body?: string;
}

export type WorkflowStep =
  | CodexExecStep
  | AttentionCreateStep
  | NotifyMacosStep
  | (JsonRecord & { type: string });

export interface WorkflowDefinition {
  id: string;
  description?: string;
  enabled?: boolean;
  triggers?: WorkflowTrigger[];
  steps?: WorkflowStep[];
}

export interface WorkflowSummary {
  id: string;
  description: string | null;
  enabled: boolean;
  canRunManually: boolean;
  scheduleCrons: string[];
  webhookEvents: string[];
}

export interface GardenStatusSummary {
  appName: string;
  appVersion: string;
  cliPath: string;
  configPath: string;
  configExists: boolean;
  dbPath: string;
}

export interface GardenConfig {
  vaultPath: string;
  tickIntervalSeconds: number;
  server: {
    host: string;
    port: number;
    secretEnv: string;
  };
  codex: CodexConfig;
  workflows: WorkflowDefinition[];
  database?: {
    path?: string;
  };
}

export interface RunWorkflowResult {
  skipped: boolean;
  run: WorkflowRun;
  error?: Error;
}

export interface ProcessEventResult {
  event: EventRecord;
  runs: RunWorkflowResult[];
}

export interface TickResult {
  cursor: string;
  runs: RunWorkflowResult[];
}

export interface CodexTaskResult {
  command: string;
  args: string[];
  exitCode: number;
  processExitCode: number;
  stdout: string;
  stderr: string;
  finalMessage: string;
  parsedStdout: unknown;
  ok: boolean;
  failureMessage: string | null;
}

export interface WorkflowRunStreamEventBase {
  type: string;
  workflowId: string;
  runId: number;
  at: string;
}

export interface WorkflowRunStartedEvent extends WorkflowRunStreamEventBase {
  type: "run.started";
  run: WorkflowRun;
}

export interface WorkflowRunSkippedEvent extends WorkflowRunStreamEventBase {
  type: "run.skipped";
  run: WorkflowRun;
  skipped: true;
  message: string;
}

export interface WorkflowStepStartedEvent extends WorkflowRunStreamEventBase {
  type: "step.started";
  stepIndex: number;
  stepType: string;
}

export interface WorkflowStepCompletedEvent extends WorkflowRunStreamEventBase {
  type: "step.completed";
  stepIndex: number;
  stepType: string;
  ok: true;
  result: JsonRecord;
}

export interface WorkflowStepFailedEvent extends WorkflowRunStreamEventBase {
  type: "step.failed";
  stepIndex: number;
  stepType: string;
  ok: false;
  message: string;
}

export interface WorkflowCodexStartedEvent extends WorkflowRunStreamEventBase {
  type: "codex.started";
  stepIndex: number;
  cwd: string | null;
  promptPreview: string;
}

export interface WorkflowCodexOutputEvent extends WorkflowRunStreamEventBase {
  type: "codex.stdout" | "codex.stderr";
  stepIndex: number;
  text: string;
}

export interface WorkflowCodexFinalMessageEvent extends WorkflowRunStreamEventBase {
  type: "codex.final_message";
  stepIndex: number;
  text: string;
}

export interface WorkflowCodexCompletedEvent extends WorkflowRunStreamEventBase {
  type: "codex.completed";
  stepIndex: number;
  exitCode: number;
  ok: boolean;
}

export interface WorkflowRunCompletedEvent extends WorkflowRunStreamEventBase {
  type: "run.completed";
  skipped: false;
  run: WorkflowRun;
}

export type WorkflowRunStreamEvent =
  | WorkflowRunStartedEvent
  | WorkflowRunSkippedEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | WorkflowCodexStartedEvent
  | WorkflowCodexOutputEvent
  | WorkflowCodexFinalMessageEvent
  | WorkflowCodexCompletedEvent
  | WorkflowRunCompletedEvent;

export type WorkflowRunEventSink = (event: WorkflowRunStreamEvent) => void | Promise<void>;

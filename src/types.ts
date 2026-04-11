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
  stdout: string;
  stderr: string;
  finalMessage: string;
  parsedStdout: unknown;
}

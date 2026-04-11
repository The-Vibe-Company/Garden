import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath, writeJsonFile, readJsonFile, ensureParentDir } from "./env.js";

export const DEFAULT_CONFIG = {
  vaultPath: "{{env.HOME}}/.granite",
  tickIntervalSeconds: 60,
  server: {
    host: "127.0.0.1",
    port: 9452,
    secretEnv: "GARDEN_WEBHOOK_SECRET"
  },
  codex: {
    command: "codex",
    sandbox: "workspace-write",
    profile: null,
    model: null,
    extraArgs: ["--skip-git-repo-check", "--ephemeral"]
  },
  workflows: [
    {
      id: "vault-garden",
      description: "Run a lightweight autonomous garden pass on the Granite vault.",
      enabled: true,
      triggers: [{ type: "schedule", cron: "0 */4 * * *" }],
      steps: [
        {
          type: "codex.exec",
          cwd: "{{env.HOME}}/Vibe",
          prompt:
            "Run /vibe_vault-garden focus=all against the Granite vault at {{config.vaultPath}}. Make only high-confidence changes and report what changed."
        }
      ]
    },
    {
      id: "scan-mail-followups",
      description: "Scan important mail threads and decide whether a human follow-up is needed.",
      enabled: true,
      triggers: [{ type: "schedule", cron: "0 * * * *" }],
      steps: [
        {
          type: "codex.exec",
          cwd: "{{env.HOME}}/Vibe",
          prompt:
            "Use /vibe_gog-mail. Review relevant client threads and decide whether a reply, review, or note update is needed. If human action is required, create Garden attention items through MCP or the Garden CLI."
        }
      ]
    },
    {
      id: "ingest-transcript",
      description: "Ingest a completed transcript into Granite using the meeting digest skill.",
      enabled: true,
      triggers: [{ type: "webhook", event: "transcript.completed" }],
      steps: [
        {
          type: "codex.exec",
          cwd: "{{env.HOME}}/Vibe",
          prompt:
            "Use /vibe_meeting-digest. A transcript is ready for ingestion.\n\nPayload:\n{{json payload}}"
        },
        {
          type: "attention.create",
          attention: {
            type: "review_needed",
            title: "Review transcript ingest for {{payload.title}}",
            body: "Workflow ingest-transcript finished. Check the generated Granite note, follow-up email, or extracted learnings.",
            priority: "medium",
            dedupeKey: "transcript-review:{{payload.id}}",
            source: "workflow:ingest-transcript"
          },
          notify: true
        }
      ]
    }
  ]
};

export function loadConfig(configPath) {
  const resolved = resolveConfigPath(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}. Run "garden init" first.`);
  }
  const config = readJsonFile(resolved);
  return { path: resolved, config: normalizeConfig(config) };
}

export function initConfig(configPath, { force = false } = {}) {
  const resolved = resolveConfigPath(configPath);
  ensureParentDir(resolved);
  if (fs.existsSync(resolved) && !force) {
    throw new Error(`Config file already exists: ${resolved}. Use --force to overwrite.`);
  }
  writeJsonFile(resolved, DEFAULT_CONFIG);
  return resolved;
}

export function normalizeConfig(config) {
  const normalized = structuredClone(DEFAULT_CONFIG);
  normalized.vaultPath = config.vaultPath ?? normalized.vaultPath;
  normalized.tickIntervalSeconds = Number(config.tickIntervalSeconds ?? normalized.tickIntervalSeconds);
  normalized.server = { ...normalized.server, ...(config.server ?? {}) };
  normalized.codex = { ...normalized.codex, ...(config.codex ?? {}) };
  normalized.workflows = Array.isArray(config.workflows) ? config.workflows : normalized.workflows;
  return normalized;
}

export function findWorkflow(config, workflowId) {
  const workflow = config.workflows.find((item) => item.id === workflowId);
  if (!workflow) {
    throw new Error(`Unknown workflow: ${workflowId}`);
  }
  return workflow;
}

export function webhookWorkflows(config, eventType) {
  return config.workflows.filter(
    (workflow) =>
      workflow.enabled !== false &&
      Array.isArray(workflow.triggers) &&
      workflow.triggers.some((trigger) => trigger.type === "webhook" && trigger.event === eventType)
  );
}

export function scheduledWorkflows(config) {
  return config.workflows.filter(
    (workflow) =>
      workflow.enabled !== false &&
      Array.isArray(workflow.triggers) &&
      workflow.triggers.some((trigger) => trigger.type === "schedule" && trigger.cron)
  );
}

export function defaultExampleConfigPath() {
  return path.resolve("examples/garden.config.json");
}

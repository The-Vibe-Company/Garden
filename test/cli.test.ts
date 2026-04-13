import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DEFAULT_CONFIG } from "../src/config.js";
import { writeJsonFile } from "../src/env.js";

test("default config keeps Codex sandboxed to the workspace", () => {
  assert.equal(DEFAULT_CONFIG.codex.sandbox, "workspace-write");
});

test("workflow list exposes stable JSON summaries for app clients", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  writeJsonFile(configPath, DEFAULT_CONFIG);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "./src/cli.ts", "workflow", "list", "--config", configPath, "--json"],
    {
      cwd: "/Users/stan/Dev/Garden",
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const workflows = JSON.parse(result.stdout) as Array<{
    id: string;
    description: string | null;
    enabled: boolean;
    canRunManually: boolean;
    scheduleCrons: string[];
    webhookEvents: string[];
  }>;

  assert.ok(workflows.length > 0);
  assert.deepEqual(workflows[0], {
    id: "vault-garden",
    description: "Run a lightweight autonomous garden pass on the Granite vault.",
    enabled: true,
    canRunManually: true,
    scheduleCrons: ["0 */4 * * *"],
    webhookEvents: []
  });
});

test("status exposes resolved config and database paths for app clients", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cli-status-test-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "garden.db");
  writeJsonFile(configPath, DEFAULT_CONFIG);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "./src/cli.ts", "status", "--config", configPath, "--db", dbPath, "--json"],
    {
      cwd: "/Users/stan/Dev/Garden",
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const status = JSON.parse(result.stdout) as {
    appName: string;
    appVersion: string;
    cliPath: string;
    configPath: string;
    configExists: boolean;
    dbPath: string;
  };

  assert.equal(status.appName, "Garden");
  assert.equal(status.appVersion, "0.1.0");
  assert.equal(status.configPath, configPath);
  assert.equal(status.configExists, true);
  assert.equal(status.dbPath, dbPath);
  assert.match(status.cliPath, /src\/cli\.ts$/);
});

test("workflow run can stream structured JSONL events for Codex steps", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cli-stream-test-"));
  const configPath = path.join(tempDir, "config.json");
  const fakeCodexPath = path.join(tempDir, "fake-codex.js");

  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "test-thread" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.started",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "echo from fake codex",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress"
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "echo from fake codex",
      aggregated_output: "codex stdout line\\n",
      exit_code: 0,
      status: "completed"
    }
  }) + "\\n");
  process.stderr.write("2026-04-13T12:15:28.157806Z  WARN codex_core::plugins::manifest: ignoring interface.defaultPrompt: prompt must be at most 128 characters path=/tmp/plugin.json\\n");
  process.stderr.write("codex stderr line\\n");
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify({
      ok: true,
      summary: "stream test succeeded",
      details: "final codex message with the full detailed report"
    }));
  }
});
`,
    "utf8"
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  writeJsonFile(configPath, {
    ...DEFAULT_CONFIG,
    codex: {
      ...DEFAULT_CONFIG.codex,
      command: fakeCodexPath,
      extraArgs: []
    },
    workflows: [
      {
        id: "stream-test",
        description: "Exercise workflow JSONL streaming.",
        enabled: true,
        steps: [
          {
            type: "codex.exec",
            prompt: "stream prompt"
          }
        ]
      }
    ]
  });

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./src/cli.ts",
      "workflow",
      "run",
      "stream-test",
      "--config",
      configPath,
      "--stream-jsonl"
    ],
    {
      cwd: "/Users/stan/Dev/Garden",
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const events = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; text?: string; run?: { status: string } });

  const eventTypes = events.map((event) => event.type);
  assert.deepEqual(eventTypes, [
    "run.started",
    "step.started",
    "codex.started",
    "codex.stdout",
    "codex.stderr",
    "codex.final_message",
    "codex.completed",
    "step.completed",
    "run.completed"
  ]);
  const stdoutEvents = events.filter((event) => event.type === "codex.stdout");
  assert.equal(stdoutEvents[0]?.text, "$ echo from fake codex\n");
  assert.equal(events.find((event) => event.type === "codex.stderr")?.text, "codex stderr line\n");
  assert.equal(
    events.find((event) => event.type === "codex.final_message")?.text,
    "final codex message with the full detailed report"
  );
  assert.equal(events.filter((event) => event.type === "codex.stderr").length, 1);
  assert.equal(events.at(-1)?.run?.status, "success");
});

test("workflow run preserves detailed Codex final messages in step results", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cli-codex-details-test-"));
  const configPath = path.join(tempDir, "config.json");
  const fakeCodexPath = path.join(tempDir, "fake-codex-details.js");

  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
process.stdin.resume();
process.stdin.on("end", () => {
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify({
      ok: true,
      summary: "short success summary",
      details: "Detailed report line 1\\n- detailed bullet"
    }));
  }
});
`,
    "utf8"
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  writeJsonFile(configPath, {
    ...DEFAULT_CONFIG,
    codex: {
      ...DEFAULT_CONFIG.codex,
      command: fakeCodexPath,
      extraArgs: []
    },
    workflows: [
      {
        id: "details-test",
        description: "Exercise preservation of detailed Codex final messages.",
        enabled: true,
        steps: [
          {
            type: "codex.exec",
            prompt: "details prompt"
          }
        ]
      }
    ]
  });

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./src/cli.ts",
      "workflow",
      "run",
      "details-test",
      "--config",
      configPath,
      "--json"
    ],
    {
      cwd: "/Users/stan/Dev/Garden",
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout) as {
    run: {
      status: string;
      details: {
        stepResults: Array<{ finalMessage: string }>;
      };
    };
  };

  assert.equal(payload.run.status, "success");
  assert.equal(payload.run.details.stepResults[0]?.finalMessage, "Detailed report line 1\n- detailed bullet");
});

test("workflow run fails when Codex reports ok false in its final structured result", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cli-codex-failure-test-"));
  const configPath = path.join(tempDir, "config.json");
  const fakeCodexPath = path.join(tempDir, "fake-codex-failure.js");

  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "test-thread" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.started",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "garden attention add ...",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress"
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "garden attention add ...",
      aggregated_output: "attempt to write a readonly database\\n",
      exit_code: 1,
      status: "failed"
    }
  }) + "\\n");
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify({
      ok: false,
      summary: "Command failed: attempt to write a readonly database",
      details: "Command failed: attempt to write a readonly database"
    }));
  }
});
`,
    "utf8"
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  writeJsonFile(configPath, {
    ...DEFAULT_CONFIG,
    codex: {
      ...DEFAULT_CONFIG.codex,
      command: fakeCodexPath,
      extraArgs: []
    },
    workflows: [
      {
        id: "failure-test",
        description: "Exercise workflow failure propagation for Codex steps.",
        enabled: true,
        steps: [
          {
            type: "codex.exec",
            prompt: "failure prompt"
          }
        ]
      }
    ]
  });

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "./src/cli.ts",
      "workflow",
      "run",
      "failure-test",
      "--config",
      configPath,
      "--json"
    ],
    {
      cwd: "/Users/stan/Dev/Garden",
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1"
      }
    }
  );

  assert.equal(result.status, 1, result.stderr);

  const payload = JSON.parse(result.stdout) as {
    skipped: boolean;
    run: { status: string; summary: string };
  };

  assert.equal(payload.skipped, false);
  assert.equal(payload.run.status, "failed");
  assert.match(payload.run.summary, /readonly database/);
});

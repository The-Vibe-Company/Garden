import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  finishWorkflowRun,
  getScheduleCursor,
  listAttentionItems,
  openGardenDb,
  setScheduleCursor,
  startWorkflowRun
} from "../src/db.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { tickScheduledWorkflows } from "../src/workflows.js";

function createTestConfig() {
  return {
    ...DEFAULT_CONFIG,
    workflows: [
      {
        id: "scheduled-attention",
        enabled: true,
        triggers: [{ type: "schedule", cron: "* * * * *" }],
        steps: [
          {
            type: "attention.create",
            attention: {
              type: "todo",
              title: "Tick {{payload.cursor}}"
            }
          }
        ]
      }
    ]
  };
}

function localDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

test("tickScheduledWorkflows backfills missed scheduled minutes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-workflow-backfill-test-"));
  const dbPath = path.join(tempDir, "garden.db");
  const { db } = await openGardenDb(dbPath);
  const config = createTestConfig();

  setScheduleCursor(db, "scheduled-attention", "2026-04-11T08:00");

  const result = await tickScheduledWorkflows({
    db,
    config,
    now: localDate(2026, 4, 11, 8, 3)
  });

  assert.equal(result.runs.length, 3);
  assert.equal(getScheduleCursor(db, "scheduled-attention"), "2026-04-11T08:03");

  const items = listAttentionItems(db, { status: "open" });
  assert.deepEqual(
    items.map((item) => item.title),
    ["Tick 2026-04-11T08:01", "Tick 2026-04-11T08:02", "Tick 2026-04-11T08:03"]
  );
});

test("tickScheduledWorkflows keeps overdue schedule cursors when a workflow run is already active", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-workflow-overlap-test-"));
  const dbPath = path.join(tempDir, "garden.db");
  const { db } = await openGardenDb(dbPath);
  const config = createTestConfig();

  setScheduleCursor(db, "scheduled-attention", "2026-04-11T08:00");
  const activeRun = startWorkflowRun(db, {
    workflowId: "scheduled-attention",
    triggerType: "manual",
    triggerValue: "manual.run"
  });

  assert.equal(activeRun.skipped, false);

  const blockedTick = await tickScheduledWorkflows({
    db,
    config,
    now: localDate(2026, 4, 11, 8, 3)
  });

  assert.equal(blockedTick.runs.length, 0);
  assert.equal(getScheduleCursor(db, "scheduled-attention"), "2026-04-11T08:00");

  finishWorkflowRun(db, activeRun.run.id, {
    status: "success",
    summary: "finished",
    details: {}
  });

  const replayedTick = await tickScheduledWorkflows({
    db,
    config,
    now: localDate(2026, 4, 11, 8, 3)
  });

  assert.equal(replayedTick.runs.length, 3);
  assert.equal(getScheduleCursor(db, "scheduled-attention"), "2026-04-11T08:03");
});

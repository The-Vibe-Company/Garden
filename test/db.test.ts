import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAttentionItem,
  listAttentionItems,
  openGardenDb,
  resolveAttentionItem,
  snoozeAttentionItem,
  summarizeToday
} from "../src/db.js";

test("attention items dedupe and today summary stays coherent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-db-test-"));
  const dbPath = path.join(tempDir, "garden.db");
  const { db } = await openGardenDb(dbPath);

  const first = createAttentionItem(db, {
    type: "reply_needed",
    title: "Reply to Monka",
    dedupeKey: "mail:monka"
  });

  const second = createAttentionItem(db, {
    type: "reply_needed",
    title: "Reply to Monka with updated context",
    dedupeKey: "mail:monka"
  });

  assert.equal(first.id, second.id);
  assert.equal(listAttentionItems(db, { status: "open" }).length, 1);

  const snoozed = snoozeAttentionItem(db, second.id, "2999-01-01T00:00:00.000Z");
  assert.equal(snoozed.status, "snoozed");

  const resolved = resolveAttentionItem(db, second.id);
  assert.equal(resolved.status, "done");

  const info = createAttentionItem(db, {
    type: "info",
    title: "Transcript ingested"
  });
  assert.ok(info.id > 0);

  const summary = summarizeToday(db);
  assert.equal(summary.actionable.length, 0);
  assert.equal(summary.info.length, 1);
});

test("dedupe refresh updates the attention type and recap bucket", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-db-dedupe-type-test-"));
  const dbPath = path.join(tempDir, "garden.db");
  const { db } = await openGardenDb(dbPath);

  createAttentionItem(db, {
    type: "info",
    title: "Transcript ingested",
    dedupeKey: "transcript:123"
  });

  const refreshed = createAttentionItem(db, {
    type: "review_needed",
    title: "Review transcript ingest",
    dedupeKey: "transcript:123"
  });

  assert.equal(refreshed.type, "review_needed");

  const summary = summarizeToday(db);
  assert.equal(summary.info.length, 0);
  assert.equal(summary.actionable.length, 1);
  assert.equal(summary.actionable[0]?.type, "review_needed");
});

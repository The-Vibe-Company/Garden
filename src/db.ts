import { ensureParentDir, nowIso, resolveDbPath } from "./env.js";
import { loadSqliteModule } from "./sqlite.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attention_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  due_at TEXT,
  snoozed_until TEXT,
  source TEXT,
  dedupe_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  links_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_cursors (
  workflow_id TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function rowToAttentionItem(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    source: row.source,
    dedupeKey: row.dedupe_key,
    metadata: JSON.parse(row.metadata_json || "{}"),
    links: JSON.parse(row.links_json || "[]")
  };
}

function rowToWorkflowRun(row) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    triggerType: row.trigger_type,
    triggerValue: row.trigger_value,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    details: JSON.parse(row.details_json || "{}")
  };
}

export async function openGardenDb(customDbPath) {
  const dbPath = resolveDbPath(customDbPath);
  ensureParentDir(dbPath);
  const { DatabaseSync } = await loadSqliteModule();
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return { db, dbPath };
}

export function createAttentionItem(db, input) {
  const now = nowIso();
  const dedupeMatch =
    input.dedupeKey &&
    db
      .prepare(
        `SELECT * FROM attention_items
         WHERE dedupe_key = ? AND status IN ('open', 'snoozed')
         ORDER BY id DESC LIMIT 1`
      )
      .get(input.dedupeKey);

  if (dedupeMatch) {
    db.prepare(
      `UPDATE attention_items
       SET title = ?, body = ?, priority = ?, due_at = ?, snoozed_until = NULL, updated_at = ?, source = ?, metadata_json = ?, links_json = ?, status = 'open'
       WHERE id = ?`
    ).run(
      input.title,
      input.body ?? null,
      input.priority ?? "medium",
      input.dueAt ?? null,
      now,
      input.source ?? null,
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.links ?? []),
      dedupeMatch.id
    );
    return getAttentionItemById(db, dedupeMatch.id);
  }

  const result = db
    .prepare(
      `INSERT INTO attention_items (
        type, title, body, status, priority, created_at, updated_at, due_at, snoozed_until, source, dedupe_key, metadata_json, links_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.type,
      input.title,
      input.body ?? null,
      input.status ?? "open",
      input.priority ?? "medium",
      now,
      now,
      input.dueAt ?? null,
      input.snoozedUntil ?? null,
      input.source ?? null,
      input.dedupeKey ?? null,
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.links ?? [])
    );

  return getAttentionItemById(db, Number(result.lastInsertRowid));
}

export function listAttentionItems(db, { status = "open" } = {}) {
  reapSnoozedItems(db);
  let query = `SELECT * FROM attention_items`;
  const params = [];
  if (status === "open") {
    query += ` WHERE status = 'open'`;
  } else if (status === "active") {
    query += ` WHERE status IN ('open', 'snoozed')`;
  } else if (status !== "all") {
    query += ` WHERE status = ?`;
    params.push(status);
  }
  query += ` ORDER BY
    CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      ELSE 4
    END,
    COALESCE(due_at, created_at) ASC,
    id ASC`;
  return db.prepare(query).all(...params).map(rowToAttentionItem);
}

export function getAttentionItemById(db, id) {
  const row = db.prepare(`SELECT * FROM attention_items WHERE id = ?`).get(id);
  return row ? rowToAttentionItem(row) : null;
}

export function resolveAttentionItem(db, id) {
  db.prepare(`UPDATE attention_items SET status = 'done', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getAttentionItemById(db, id);
}

export function dismissAttentionItem(db, id) {
  db.prepare(`UPDATE attention_items SET status = 'dismissed', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getAttentionItemById(db, id);
}

export function snoozeAttentionItem(db, id, until) {
  db.prepare(
    `UPDATE attention_items SET status = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?`
  ).run(until, nowIso(), id);
  return getAttentionItemById(db, id);
}

export function reapSnoozedItems(db, now = nowIso()) {
  db.prepare(
    `UPDATE attention_items SET status = 'open', snoozed_until = NULL, updated_at = ? WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?`
  ).run(now, now);
}

export function summarizeToday(db) {
  reapSnoozedItems(db);
  const openItems = listAttentionItems(db, { status: "open" });
  const actionable = openItems.filter((item) => item.type !== "info");
  const info = openItems.filter((item) => item.type === "info");
  const recentRuns = db
    .prepare(`SELECT * FROM workflow_runs ORDER BY id DESC LIMIT 10`)
    .all()
    .map(rowToWorkflowRun);

  return {
    generatedAt: nowIso(),
    actionable,
    info,
    recentRuns
  };
}

export function recordEvent(db, { eventType, payload, source = "garden" }) {
  const receivedAt = nowIso();
  const result = db
    .prepare(
      `INSERT INTO events (event_type, payload_json, source, received_at) VALUES (?, ?, ?, ?)`
    )
    .run(eventType, JSON.stringify(payload ?? {}), source, receivedAt);
  return {
    id: Number(result.lastInsertRowid),
    eventType,
    payload,
    source,
    receivedAt
  };
}

export function startWorkflowRun(db, { workflowId, triggerType, triggerValue, details = {} }) {
  const startedAt = nowIso();
  const activeRun = db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE workflow_id = ? AND status = 'running'
       ORDER BY id DESC LIMIT 1`
    )
    .get(workflowId);

  if (activeRun) {
    return { skipped: true, run: rowToWorkflowRun(activeRun) };
  }

  const result = db
    .prepare(
      `INSERT INTO workflow_runs (workflow_id, trigger_type, trigger_value, status, started_at, details_json)
       VALUES (?, ?, ?, 'running', ?, ?)`
    )
    .run(workflowId, triggerType, triggerValue ?? null, startedAt, JSON.stringify(details));

  return {
    skipped: false,
    run: getWorkflowRun(db, Number(result.lastInsertRowid))
  };
}

export function finishWorkflowRun(db, runId, { status, summary, details }) {
  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, summary = ?, finished_at = ?, details_json = ?
     WHERE id = ?`
  ).run(status, summary ?? null, nowIso(), JSON.stringify(details ?? {}), runId);
  return getWorkflowRun(db, runId);
}

export function getWorkflowRun(db, runId) {
  const row = db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId);
  return row ? rowToWorkflowRun(row) : null;
}

export function getScheduleCursor(db, workflowId) {
  const row = db.prepare(`SELECT cursor FROM schedule_cursors WHERE workflow_id = ?`).get(workflowId);
  return row?.cursor ?? null;
}

export function setScheduleCursor(db, workflowId, cursor) {
  db.prepare(
    `INSERT INTO schedule_cursors (workflow_id, cursor, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(workflow_id)
     DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`
  ).run(workflowId, cursor, nowIso());
}

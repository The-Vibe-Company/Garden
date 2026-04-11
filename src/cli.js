#!/usr/bin/env -S node --no-warnings

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { parseArgs } from "node:util";
import { APP_NAME, APP_VERSION, maybeParseJson, parseIsoDate, readJsonFile } from "./env.js";
import { initConfig, loadConfig, findWorkflow } from "./config.js";
import {
  createAttentionItem,
  listAttentionItems,
  openGardenDb,
  resolveAttentionItem,
  snoozeAttentionItem,
  summarizeToday
} from "./db.js";
import { processEvent, runWorkflow, tickScheduledWorkflows } from "./workflows.js";
import { runMcpServer } from "./mcp.js";
import { notifyMacos } from "./notifier.js";

function printHelp() {
  console.log(`${APP_NAME} ${APP_VERSION}

Commands:
  init [--config <path>] [--force]
  today [--json] [--config <path>] [--db <path>]
  tick [--config <path>] [--db <path>]
  daemon [--config <path>] [--db <path>] [--port <n>] [--tick-seconds <n>]
  attention add --type <type> --title <title> [--body <body>] [--priority <priority>] [--notify]
  attention list [--status <status>] [--json]
  attention resolve <id>
  attention snooze <id> --until <iso-date>
  workflow run <workflow-id> [--payload-file <file>] [--event <event>] [--json]
  webhook emit <event-type> [--payload-file <file>] [--json]
  mcp
  help
`);
}

function readPayloadFile(payloadFile) {
  if (!payloadFile) {
    return {};
  }
  const absolutePath = path.resolve(payloadFile);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Payload file not found: ${absolutePath}`);
  }
  return readJsonFile(absolutePath);
}

function parseRootOptions(argv) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      db: { type: "string" },
      json: { type: "boolean" },
      force: { type: "boolean" },
      port: { type: "string" },
      "tick-seconds": { type: "string" }
    }
  });
}

function printToday(today, { asJson = false } = {}) {
  if (asJson) {
    console.log(JSON.stringify(today, null, 2));
    return;
  }

  console.log("Today\n");

  if (today.actionable.length > 0) {
    console.log("Actionable");
    for (const item of today.actionable) {
      console.log(`${item.id}. [${item.type}] ${item.title}`);
    }
    console.log("");
  }

  if (today.info.length > 0) {
    console.log("New Info");
    for (const item of today.info) {
      console.log(`- ${item.title}`);
    }
    console.log("");
  }

  if (today.recentRuns.length > 0) {
    console.log("Recent Runs");
    for (const run of today.recentRuns) {
      console.log(`- ${run.workflowId}: ${run.status}`);
    }
  }
}

async function handleInit(argv) {
  const parsed = parseRootOptions(argv);
  const configPath = initConfig(parsed.values.config, { force: parsed.values.force === true });
  console.log(`Created config at ${configPath}`);
}

async function handleToday(argv) {
  const parsed = parseRootOptions(argv);
  const { db } = await openGardenDb(parsed.values.db);
  try {
    const today = summarizeToday(db);
    printToday(today, { asJson: parsed.values.json === true });
  } finally {
    db.close();
  }
}

async function handleAttention(argv) {
  const [subcommand, ...rest] = argv;
  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      type: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      priority: { type: "string" },
      source: { type: "string" },
      "dedupe-key": { type: "string" },
      "due-at": { type: "string" },
      until: { type: "string" },
      notify: { type: "boolean" },
      status: { type: "string" },
      json: { type: "boolean" },
      db: { type: "string" }
    }
  });

  const { db } = await openGardenDb(parsed.values.db);
  try {
    if (subcommand === "add") {
      const item = createAttentionItem(db, {
        type: parsed.values.type,
        title: parsed.values.title,
        body: parsed.values.body,
        priority: parsed.values.priority,
        source: parsed.values.source,
        dedupeKey: parsed.values["dedupe-key"],
        dueAt: parsed.values["due-at"]
      });
      if (parsed.values.notify) {
        await notifyMacos({
          title: `Garden: ${item.type}`,
          subtitle: item.priority,
          body: item.title
        });
      }
      if (parsed.values.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(`Created attention item #${item.id}: ${item.title}`);
      }
      return;
    }

    if (subcommand === "list") {
      const items = listAttentionItems(db, { status: parsed.values.status ?? "open" });
      if (parsed.values.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      for (const item of items) {
        console.log(`${item.id}. [${item.type}] ${item.title} (${item.status})`);
      }
      return;
    }

    if (subcommand === "resolve") {
      const id = Number(parsed.positionals[0]);
      const item = resolveAttentionItem(db, id);
      if (!item) {
        throw new Error(`Attention item not found: ${id}`);
      }
      console.log(`Resolved attention item #${item.id}: ${item.title}`);
      return;
    }

    if (subcommand === "snooze") {
      const id = Number(parsed.positionals[0]);
      parseIsoDate(parsed.values.until);
      const item = snoozeAttentionItem(db, id, parsed.values.until);
      if (!item) {
        throw new Error(`Attention item not found: ${id}`);
      }
      console.log(`Snoozed attention item #${item.id} until ${item.snoozedUntil}`);
      return;
    }
  } finally {
    db.close();
  }

  throw new Error(`Unknown attention subcommand: ${subcommand}`);
}

async function handleTick(argv) {
  const parsed = parseRootOptions(argv);
  const { config } = loadConfig(parsed.values.config);
  const { db } = await openGardenDb(parsed.values.db);
  try {
    const result = await tickScheduledWorkflows({ db, config });
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Tick ${result.cursor}: ${result.runs.length} workflow(s) executed.`);
    }
    if (result.runs.some((run) => run.run?.status === "failed")) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

async function handleWorkflow(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "run") {
    throw new Error(`Unknown workflow subcommand: ${subcommand}`);
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      db: { type: "string" },
      event: { type: "string" },
      "payload-file": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const workflowId = parsed.positionals[0];
  const payload = readPayloadFile(parsed.values["payload-file"]);
  const { config } = loadConfig(parsed.values.config);
  const workflow = findWorkflow(config, workflowId);
  const { db } = await openGardenDb(parsed.values.db);
  try {
    const result = await runWorkflow({
      db,
      config,
      workflow,
      triggerType: "manual",
      triggerValue: workflowId,
      event: {
        type: parsed.values.event ?? "manual.run",
        payload
      }
    });
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Workflow ${workflowId}: ${result.run.status}`);
    }
    if (result.run.status === "failed") {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

async function handleWebhook(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "emit") {
    throw new Error(`Unknown webhook subcommand: ${subcommand}`);
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      db: { type: "string" },
      "payload-file": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const eventType = parsed.positionals[0];
  const payload = readPayloadFile(parsed.values["payload-file"]);
  const { config } = loadConfig(parsed.values.config);
  const { db } = await openGardenDb(parsed.values.db);
  try {
    const result = await processEvent({
      db,
      config,
      eventType,
      payload,
      source: "cli"
    });
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Event ${eventType}: ${result.runs.length} workflow(s) triggered.`);
    }
    if (result.runs.some((run) => run.run?.status === "failed")) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

async function handleDaemon(argv) {
  const parsed = parseRootOptions(argv);
  const { config } = loadConfig(parsed.values.config);
  const { db, dbPath } = await openGardenDb(parsed.values.db);
  const port = Number(parsed.values.port ?? config.server.port ?? 9452);
  const host = config.server.host ?? "127.0.0.1";
  const tickSeconds = Number(parsed.values["tick-seconds"] ?? config.tickIntervalSeconds ?? 60);

  const secretEnv = config.server.secretEnv;
  const expectedSecret = secretEnv ? process.env[secretEnv] : null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "POST" && url.pathname.startsWith("/events/")) {
      if (expectedSecret) {
        const authHeader = req.headers.authorization;
        const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.headers["x-garden-secret"];
        if (provided !== expectedSecret) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", async () => {
        const payload = body ? maybeParseJson(body, {}) : {};
        const eventType = decodeURIComponent(url.pathname.slice("/events/".length));
        const result = await processEvent({
          db,
          config,
          eventType,
          payload,
          source: "webhook"
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, dbPath }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, host, () => {
    console.log(`Garden daemon listening on http://${host}:${port}`);
    console.log(`Database: ${dbPath}`);
  });

  const tickLoop = async () => {
    try {
      const result = await tickScheduledWorkflows({ db, config });
      if (result.runs.length > 0) {
        console.log(`Tick ${result.cursor}: ran ${result.runs.length} workflow(s).`);
      }
    } catch (error) {
      console.error(`Tick failed: ${error.message}`);
    }
  };

  await tickLoop();
  setInterval(tickLoop, tickSeconds * 1000);
}

async function handleMcp(argv) {
  const parsed = parseRootOptions(argv);
  const { config } = loadConfig(parsed.values.config);
  const { db } = await openGardenDb(parsed.values.db);
  await runMcpServer({ db, config });
}

async function main() {
  const [, , command, ...argv] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    await handleInit(argv);
    return;
  }
  if (command === "today") {
    await handleToday(argv);
    return;
  }
  if (command === "attention") {
    await handleAttention(argv);
    return;
  }
  if (command === "tick") {
    await handleTick(argv);
    return;
  }
  if (command === "workflow") {
    await handleWorkflow(argv);
    return;
  }
  if (command === "webhook") {
    await handleWebhook(argv);
    return;
  }
  if (command === "daemon") {
    await handleDaemon(argv);
    return;
  }
  if (command === "mcp") {
    await handleMcp(argv);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

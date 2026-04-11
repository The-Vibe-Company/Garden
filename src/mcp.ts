import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  createAttentionItem,
  listAttentionItems,
  resolveAttentionItem,
  snoozeAttentionItem,
  summarizeToday
} from "./db.js";
import { findWorkflow } from "./config.js";
import { parseIsoDate } from "./env.js";
import { processEvent, runWorkflow } from "./workflows.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

const attentionItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(["open", "snoozed", "done", "dismissed"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  dueAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  source: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  links: z.array(z.unknown())
});

const workflowRunSchema = z.object({
  id: z.number(),
  workflowId: z.string(),
  triggerType: z.enum(["manual", "schedule", "webhook"]),
  triggerValue: z.string().nullable(),
  status: z.enum(["running", "success", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  summary: z.string().nullable(),
  details: z.record(z.string(), z.unknown())
});

const todaySummarySchema = z.object({
  generatedAt: z.string(),
  actionable: z.array(attentionItemSchema),
  info: z.array(attentionItemSchema),
  recentRuns: z.array(workflowRunSchema)
});

const eventRecordSchema = z.object({
  id: z.number(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  source: z.string(),
  receivedAt: z.string()
});

const workflowResultSchema = z.object({
  skipped: z.boolean(),
  run: workflowRunSchema,
  error: z.object({ message: z.string() }).optional()
});

function toolResult(structuredContent: unknown, summary: string) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: structuredContent as Record<string, unknown>
  };
}

function renderTodayMarkdown(today: ReturnType<typeof summarizeToday>) {
  const lines = [
    "# Garden Today",
    "",
    `Generated at: ${today.generatedAt}`,
    "",
    `Actionable: ${today.actionable.length}`,
    `Info: ${today.info.length}`,
    `Recent runs: ${today.recentRuns.length}`
  ];

  if (today.actionable.length > 0) {
    lines.push("", "## Actionable");
    for (const item of today.actionable) {
      lines.push(`- [${item.type}] ${item.title}`);
    }
  }

  if (today.info.length > 0) {
    lines.push("", "## Info");
    for (const item of today.info) {
      lines.push(`- ${item.title}`);
    }
  }

  return lines.join("\n");
}

function createGardenMcpServer({ db, config }) {
  const server = new McpServer(
    {
      name: "garden",
      version: "0.1.0",
      title: "Garden MCP Server"
    },
    {
      capabilities: { logging: {} },
      instructions: [
        "# Garden — Local Attention Runtime",
        "",
        "Garden is a deterministic local runtime around Granite.",
        "Use Garden when you need to inspect or mutate the attention queue, trigger workflows, or emit operational events.",
        "",
        "Prefer `garden_get_today` for the operator recap and use attention items instead of ad-hoc notifications."
      ].join("\n")
    }
  );

  server.registerTool("garden_add_attention_item", {
    title: "Add Garden Attention Item",
    description: "Create or refresh an attention item in Garden.",
    inputSchema: {
      type: z.string().describe("Garden attention item type."),
      title: z.string().describe("Short title shown in the Garden queue."),
      body: z.string().optional().describe("Optional longer description."),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority for sorting and notification policies."),
      source: z.string().optional().describe("Where the item came from."),
      dedupeKey: z.string().optional().describe("Stable key used to refresh an existing open item instead of creating a duplicate."),
      dueAt: z.string().optional().describe("Optional ISO timestamp."),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Structured metadata preserved on the item.")
    },
    outputSchema: attentionItemSchema,
    annotations: writeAnnotations
  }, async (args) => {
    const item = createAttentionItem(db, args);
    return toolResult(item, `Created attention item #${item.id}: ${item.title}`);
  });

  server.registerTool("garden_list_attention_items", {
    title: "List Garden Attention Items",
    description: "List attention items from Garden.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status. Defaults to open.")
    },
    outputSchema: z.object({
      items: z.array(attentionItemSchema)
    }),
    annotations: readOnlyAnnotations
  }, async ({ status }) => {
    const items = listAttentionItems(db, { status: status ?? "open" });
    return toolResult({ items }, `Returned ${items.length} attention item(s).`);
  });

  server.registerTool("garden_resolve_attention_item", {
    title: "Resolve Garden Attention Item",
    description: "Resolve an attention item by numeric id.",
    inputSchema: {
      id: z.number().int().describe("Attention item id.")
    },
    outputSchema: attentionItemSchema.nullable(),
    annotations: writeAnnotations
  }, async ({ id }) => {
    const item = resolveAttentionItem(db, id);
    return toolResult(item, item ? `Resolved attention item #${id}.` : `Attention item #${id} was not found.`);
  });

  server.registerTool("garden_snooze_attention_item", {
    title: "Snooze Garden Attention Item",
    description: "Snooze an attention item until an ISO timestamp.",
    inputSchema: {
      id: z.number().int().describe("Attention item id."),
      until: z.string().describe("ISO timestamp to snooze until.")
    },
    outputSchema: attentionItemSchema.nullable(),
    annotations: writeAnnotations
  }, async ({ id, until }) => {
    parseIsoDate(until);
    const item = snoozeAttentionItem(db, id, until);
    return toolResult(item, item ? `Snoozed attention item #${id} until ${until}.` : `Attention item #${id} was not found.`);
  });

  server.registerTool("garden_get_today", {
    title: "Get Garden Today",
    description: "Return the current Garden recap.",
    outputSchema: todaySummarySchema,
    annotations: readOnlyAnnotations
  }, async () => {
    const today = summarizeToday(db);
    return toolResult(today, renderTodayMarkdown(today));
  });

  server.registerTool("garden_run_workflow", {
    title: "Run Garden Workflow",
    description: "Run a workflow by id.",
    inputSchema: {
      workflowId: z.string().describe("Workflow id to run."),
      payload: z.record(z.string(), z.unknown()).optional().describe("Optional payload injected into the manual run event.")
    },
    outputSchema: workflowResultSchema,
    annotations: writeAnnotations
  }, async ({ workflowId, payload }) => {
    const workflow = findWorkflow(config, workflowId);
    const result = await runWorkflow({
      db,
      config,
      workflow,
      triggerType: "manual",
      triggerValue: workflowId,
      event: {
        type: "manual.run",
        payload: payload ?? {}
      }
    });

    return toolResult(
      {
        ...result,
        error: result.error ? { message: result.error.message } : undefined
      },
      `Ran workflow ${workflowId}.`
    );
  });

  server.registerTool("garden_emit_event", {
    title: "Emit Garden Event",
    description: "Emit a webhook-style event directly into Garden.",
    inputSchema: {
      eventType: z.string().describe("Event type name."),
      payload: z.record(z.string(), z.unknown()).optional().describe("Event payload.")
    },
    outputSchema: z.object({
      event: eventRecordSchema,
      runs: z.array(workflowResultSchema)
    }),
    annotations: writeAnnotations
  }, async ({ eventType, payload }) => {
    const result = await processEvent({
      db,
      config,
      eventType,
      payload: payload ?? {},
      source: "mcp"
    });

    return toolResult(
      {
        event: result.event,
        runs: result.runs.map((run) => ({
          ...run,
          error: run.error ? { message: run.error.message } : undefined
        }))
      },
      `Emitted event ${eventType}.`
    );
  });

  server.registerResource("garden-today", "garden://today", {
    title: "Garden Today",
    description: "Markdown recap of the current Garden queue and recent runs.",
    mimeType: "text/markdown"
  }, async () => {
    const today = summarizeToday(db);
    return {
      contents: [{
        uri: "garden://today",
        text: renderTodayMarkdown(today),
        mimeType: "text/markdown"
      }]
    };
  });

  server.registerPrompt("garden_triage_attention", {
    title: "Triage Garden Attention",
    description: "Review the current Garden queue and decide what requires human attention right now."
  }, async () => {
    const today = summarizeToday(db);
    return {
      description: "Review the current Garden attention queue.",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            "Review the attached Garden recap.",
            "Identify what should be acted on now, what can wait, and whether any item should be resolved, snoozed, or converted into a more durable output."
          ].join(" ")
        }
      }, {
        role: "user",
        content: {
          type: "resource",
          resource: {
            uri: "garden://today",
            text: renderTodayMarkdown(today),
            mimeType: "text/markdown"
          }
        }
      }]
    };
  });

  return server;
}

export async function runMcpServer({ db, config }) {
  const server = createGardenMcpServer({ db, config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

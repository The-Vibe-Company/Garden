import {
  createAttentionItem,
  listAttentionItems,
  resolveAttentionItem,
  snoozeAttentionItem,
  summarizeToday
} from "./db.js";
import { parseIsoDate } from "./env.js";
import { processEvent, runWorkflow } from "./workflows.js";
import { findWorkflow } from "./config.js";

const PROTOCOL_VERSION = "2025-11-05";

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function textResult(text, structuredContent = undefined) {
  return {
    content: [{ type: "text", text }],
    structuredContent
  };
}

function createToolList() {
  return [
    {
      name: "garden_add_attention_item",
      description: "Create or refresh an attention item in Garden.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          source: { type: "string" },
          dedupeKey: { type: "string" },
          dueAt: { type: "string" },
          metadata: { type: "object" }
        },
        required: ["type", "title"]
      }
    },
    {
      name: "garden_list_attention_items",
      description: "List attention items from Garden.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" }
        }
      }
    },
    {
      name: "garden_resolve_attention_item",
      description: "Resolve an attention item by numeric id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number" }
        },
        required: ["id"]
      }
    },
    {
      name: "garden_snooze_attention_item",
      description: "Snooze an attention item until an ISO timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number" },
          until: { type: "string" }
        },
        required: ["id", "until"]
      }
    },
    {
      name: "garden_get_today",
      description: "Return the current Garden recap.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "garden_run_workflow",
      description: "Run a workflow by id.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          payload: { type: "object" }
        },
        required: ["workflowId"]
      }
    },
    {
      name: "garden_emit_event",
      description: "Emit a webhook-style event directly into Garden.",
      inputSchema: {
        type: "object",
        properties: {
          eventType: { type: "string" },
          payload: { type: "object" }
        },
        required: ["eventType"]
      }
    }
  ];
}

async function handleToolCall({ db, config, params }) {
  const { name, arguments: args = {} } = params;

  switch (name) {
    case "garden_add_attention_item": {
      const item = createAttentionItem(db, args);
      return textResult(`Created attention item #${item.id}: ${item.title}`, item);
    }
    case "garden_list_attention_items": {
      const items = listAttentionItems(db, { status: args.status ?? "open" });
      return textResult(`Returned ${items.length} attention item(s).`, { items });
    }
    case "garden_resolve_attention_item": {
      const item = resolveAttentionItem(db, args.id);
      return textResult(`Resolved attention item #${args.id}.`, item);
    }
    case "garden_snooze_attention_item": {
      parseIsoDate(args.until);
      const item = snoozeAttentionItem(db, args.id, args.until);
      return textResult(`Snoozed attention item #${args.id} until ${args.until}.`, item);
    }
    case "garden_get_today": {
      const today = summarizeToday(db);
      return textResult("Garden today summary loaded.", today);
    }
    case "garden_run_workflow": {
      const workflow = findWorkflow(config, args.workflowId);
      const result = await runWorkflow({
        db,
        config,
        workflow,
        triggerType: "manual",
        triggerValue: args.workflowId,
        event: {
          type: "manual.run",
          payload: args.payload ?? {}
        }
      });
      return textResult(`Ran workflow ${args.workflowId}.`, result);
    }
    case "garden_emit_event": {
      const result = await processEvent({
        db,
        config,
        eventType: args.eventType,
        payload: args.payload ?? {},
        source: "mcp"
      });
      return textResult(`Emitted event ${args.eventType}.`, result);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runMcpServer({ db, config }) {
  let buffer = Buffer.alloc(0);

  async function onMessage(message) {
    if (message.method === "notifications/initialized") {
      return;
    }

    if (message.method === "initialize") {
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "garden",
            version: "0.1.0"
          }
        }
      });
      return;
    }

    if (message.method === "ping") {
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {}
      });
      return;
    }

    if (message.method === "tools/list") {
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: createToolList()
        }
      });
      return;
    }

    if (message.method === "tools/call") {
      try {
        const result = await handleToolCall({ db, config, params: message.params });
        sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          result
        });
      } catch (error) {
        sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: error.message
          }
        });
      }
      return;
    }

    if (message.id != null) {
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`
        }
      });
    }
  }

  process.stdin.on("data", async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }
      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        throw new Error("Missing Content-Length header.");
      }
      const contentLength = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) {
        break;
      }
      const payload = buffer.subarray(messageStart, messageEnd).toString("utf8");
      buffer = buffer.subarray(messageEnd);
      const message = JSON.parse(payload);
      await onMessage(message);
    }
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_CONFIG } from "../src/config.js";
import { writeJsonFile } from "../src/env.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function encodeMessage(message: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
}

function createMcpReader(stream: NodeJS.ReadableStream) {
  let buffer = Buffer.alloc(0);
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  stream.on("data", (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) {
        break;
      }

      const payload = buffer.subarray(0, lineEnd).toString("utf8").replace(/\r$/, "");
      buffer = buffer.subarray(lineEnd + 1);

      const message = JSON.parse(payload);
      if (message.id != null && pending.has(message.id)) {
        const handlers = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          handlers?.reject(new Error(message.error.message));
        } else {
          handlers?.resolve(message.result);
        }
      }
    }
  });

  return {
    request(child, message: { id: number; [key: string]: unknown }) {
      child.stdin.write(encodeMessage(message));
      return new Promise((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
      });
    }
  };
}

test("Garden MCP exposes tools and serves garden_get_today over stdio", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-mcp-test-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "garden.db");
  writeJsonFile(configPath, DEFAULT_CONFIG);

  const child = spawn(process.execPath, ["--import", "tsx", "./src/cli.ts", "mcp", "--config", configPath, "--db", dbPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  const reader = createMcpReader(child.stdout);

  try {
    const initResult = await reader.request(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-05",
        capabilities: {},
        clientInfo: { name: "garden-test", version: "0.1.0" }
      }
    });

    assert.equal((initResult as { serverInfo: { name: string } }).serverInfo.name, "garden");
    child.stdin.write(encodeMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    }));

    const listResult = await reader.request(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });

    const toolNames = (listResult as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("garden_get_today"));

    const todayResult = await reader.request(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "garden_get_today",
        arguments: {}
      }
    });

    const todayContent = (todayResult as {
      structuredContent: { actionable: unknown[]; info: unknown[] };
    }).structuredContent;
    assert.equal(todayContent.actionable.length, 0);
    assert.equal(todayContent.info.length, 0);
    assert.match(stderrChunks.join(""), /Garden MCP server listening on stdio/);
  } finally {
    child.kill();
  }
});

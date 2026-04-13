import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { expandHome, maybeParseJson } from "./env.js";
import type { CodexConfig, CodexTaskResult } from "./types.js";

function createTempOutputFile(): string {
  return path.join(os.tmpdir(), `garden-codex-output-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

function createTempSchemaFile(): string {
  const schemaPath = path.join(os.tmpdir(), `garden-codex-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        type: "object",
        required: ["ok", "summary", "details"],
        properties: {
          ok: { type: "boolean" },
          summary: { type: "string" },
          details: { type: "string" }
        },
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  return schemaPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStructuredFinalMessage(finalMessage: string): { ok: boolean; summary: string; details: string } | null {
  const parsed = maybeParseJson(finalMessage);
  if (
    !isRecord(parsed) ||
    typeof parsed.ok !== "boolean" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.details !== "string"
  ) {
    return null;
  }
  return {
    ok: parsed.ok,
    summary: parsed.summary,
    details: parsed.details
  };
}

function normalizeCodexStderr(text: string): string {
  const ignoredPatterns = [
    "codex_core::plugins::manifest: ignoring interface.defaultPrompt",
    "codex_core::shell_snapshot: Failed to delete shell snapshot"
  ];

  const lines = text
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => !ignoredPatterns.some((pattern) => line.includes(pattern)));

  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n`;
}

export async function runCodexTask({
  codexConfig,
  prompt,
  cwd,
  workflowId,
  onStdout,
  onStderr,
  onFinalMessage
}: {
  codexConfig: CodexConfig;
  prompt: string;
  cwd?: string;
  workflowId?: string;
  onStdout?: (text: string) => void | Promise<void>;
  onStderr?: (text: string) => void | Promise<void>;
  onFinalMessage?: (text: string) => void | Promise<void>;
}): Promise<CodexTaskResult> {
  const outputFile = createTempOutputFile();
  const schemaFile = createTempSchemaFile();
  const command = expandHome(codexConfig.command ?? "codex");
  const args = ["exec", "--json", "--output-schema", schemaFile, "-o", outputFile];
  const promptWithContract = `${prompt}

Return a final JSON object matching the output schema.
Set "ok" to true only if the requested work is fully complete.
Set "ok" to false if anything failed, was blocked, or was only partially completed.
Put the concise outcome or failure reason in "summary".
Put the full message you would normally return to the user in "details".
If the task asks for a report, bullets, or an explanation, keep that content in "details".`;

  if (cwd) {
    args.push("-C", expandHome(cwd));
  }
  if (codexConfig.sandbox) {
    args.push("-s", codexConfig.sandbox);
  }
  if (codexConfig.profile) {
    args.push("-p", codexConfig.profile);
  }
  if (codexConfig.model) {
    args.push("-m", codexConfig.model);
  }
  if (Array.isArray(codexConfig.extraArgs)) {
    args.push(...codexConfig.extraArgs);
  }
  args.push("-");

  return new Promise<CodexTaskResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: expandHome(cwd ?? process.cwd()),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GARDEN_WORKFLOW_ID: workflowId ?? ""
      }
    });

    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let streamQueue = Promise.resolve();
    let resolved = false;

    const enqueue = (callback, text) => {
      if (!callback || text.length === 0) {
        return;
      }

      streamQueue = streamQueue
        .then(() => callback(text))
        .catch(() => {});
    };

    const handleStructuredStdoutLine = (line) => {
      const parsed = maybeParseJson(line);
      if (!isRecord(parsed) || typeof parsed.type !== "string") {
        enqueue(onStdout, `${line}\n`);
        return;
      }

      const item = isRecord(parsed.item) ? parsed.item : null;
      if (!item || typeof item.type !== "string") {
        return;
      }

      if (item.type !== "command_execution") {
        return;
      }

      if (parsed.type === "item.started" && typeof item.command === "string") {
        enqueue(onStdout, `$ ${item.command}\n`);
        return;
      }

      if (parsed.type === "item.completed") {
        const failed = item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
        if (failed && typeof item.command === "string") {
          const exitCode = typeof item.exit_code === "number" ? item.exit_code : 1;
          enqueue(onStderr, `Command failed with exit code ${exitCode}: ${item.command}\n`);
        }
      }
    };

    const flushStdoutLines = () => {
      if (!stdoutLineBuffer) {
        return;
      }
      handleStructuredStdoutLine(stdoutLineBuffer);
      stdoutLineBuffer = "";
    };

    const finish = async (code, errorMessage = "") => {
      if (resolved) {
        return;
      }
      resolved = true;

      flushStdoutLines();

      const finalMessage = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8")
        : "";
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      if (fs.existsSync(schemaFile)) {
        fs.unlinkSync(schemaFile);
      }

      const structuredFinal = parseStructuredFinalMessage(finalMessage);
      const effectiveFinalMessage = structuredFinal?.details.trim() || structuredFinal?.summary || finalMessage.trim();
      const ok =
        (code ?? 1) === 0 &&
        structuredFinal !== null &&
        structuredFinal.ok === true;
      const failureMessage =
        errorMessage.trim() ||
        (structuredFinal === null
          ? `Codex returned an invalid final response. Expected JSON with ok, summary, and details.`
          : structuredFinal.ok
            ? null
            : structuredFinal.summary);
      const effectiveExitCode =
        ok ? 0 : (code ?? 0) !== 0 ? (code ?? 1) : 1;

      enqueue(onFinalMessage, effectiveFinalMessage);
      await streamQueue;

      resolve({
        command,
        args,
        exitCode: effectiveExitCode,
        processExitCode: code ?? 1,
        stdout,
        stderr: errorMessage ? `${stderr}${errorMessage}\n` : stderr,
        finalMessage: effectiveFinalMessage,
        parsedStdout: maybeParseJson(stdout),
        ok,
        failureMessage
      });
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutLineBuffer += text;

      let newlineIndex = stdoutLineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutLineBuffer.slice(0, newlineIndex);
        stdoutLineBuffer = stdoutLineBuffer.slice(newlineIndex + 1);
        handleStructuredStdoutLine(line);
        newlineIndex = stdoutLineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const filteredText = normalizeCodexStderr(text);
      stderr += filteredText;
      enqueue(onStderr, filteredText);
    });

    child.stdin.write(promptWithContract);
    child.stdin.end();

    child.on("error", (error) => {
      void finish(1, error.message);
    });

    child.on("close", (code) => {
      void finish(code);
    });
  });
}

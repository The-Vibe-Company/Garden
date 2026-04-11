import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { expandHome, maybeParseJson } from "./env.js";
import type { CodexConfig, CodexTaskResult } from "./types.js";

function createTempOutputFile(): string {
  return path.join(os.tmpdir(), `garden-codex-output-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

export async function runCodexTask({
  codexConfig,
  prompt,
  cwd,
  workflowId
}: {
  codexConfig: CodexConfig;
  prompt: string;
  cwd?: string;
  workflowId?: string;
}): Promise<CodexTaskResult> {
  const outputFile = createTempOutputFile();
  const command = expandHome(codexConfig.command ?? "codex");
  const args = ["exec", "-o", outputFile];

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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on("close", (code) => {
      const finalMessage = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8")
        : "";
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }

      resolve({
        command,
        args,
        exitCode: code ?? 1,
        stdout,
        stderr,
        finalMessage,
        parsedStdout: maybeParseJson(stdout)
      });
    });
  });
}

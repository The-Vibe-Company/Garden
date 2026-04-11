import { spawn } from "node:child_process";

function toAppleScriptString(input) {
  return String(input ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function notifyMacos({ title, subtitle = "", body = "" }) {
  if (process.platform !== "darwin") {
    return { delivered: false, reason: "not-macos" };
  }

  const scriptParts = [`display notification "${toAppleScriptString(body)}" with title "${toAppleScriptString(title)}"`];
  if (subtitle) {
    scriptParts[0] += ` subtitle "${toAppleScriptString(subtitle)}"`;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", scriptParts[0]], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ delivered: true });
      } else {
        reject(new Error(stderr.trim() || `osascript failed with code ${code}`));
      }
    });
  });
}

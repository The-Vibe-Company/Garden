import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_NAME = "Garden";
export const APP_VERSION = "0.1.0";

export function nowIso() {
  return new Date().toISOString();
}

export function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveGardenDir(customDir) {
  return path.resolve(expandHome(customDir ?? "~/.garden"));
}

export function resolveConfigPath(customPath) {
  return path.resolve(expandHome(customPath ?? "~/.garden/config.json"));
}

export function resolveDbPath(customPath) {
  return path.resolve(expandHome(customPath ?? "~/.garden/garden.db"));
}

export function ensureParentDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function maybeParseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

export function minuteCursorKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

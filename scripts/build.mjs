import fs from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1"
    }
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

const distPath = new URL("../dist", import.meta.url);
const cliPath = new URL("../dist/src/cli.js", import.meta.url);

console.log("Building Garden v0");
fs.rmSync(distPath, { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.build.json"], "compile");
fs.chmodSync(cliPath, 0o755);
run("node", ["./dist/src/cli.js", "help"], "CLI smoke test");
console.log("Garden build complete");

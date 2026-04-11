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

console.log("Building Garden v0");
run("npm", ["test"], "test suite");
run("npm", ["run", "typecheck"], "typecheck");
run("node", ["./dist/src/cli.js", "help"], "CLI smoke test");
console.log("Garden build complete");

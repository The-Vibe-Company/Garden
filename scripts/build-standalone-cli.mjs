import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const SEA_RESOURCE_NAME = "NODE_SEA_BLOB";
const SEA_SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SEA_SEGMENT = "NODE_SEA";

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }

  return result;
}

function runBestEffort(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function parseArgs(argv) {
  const options = {
    output: path.resolve(".build/standalone/garden"),
    smokeTest: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      options.output = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--smoke-test") {
      options.smokeTest = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node ./scripts/build-standalone-cli.mjs [--output <path>] [--smoke-test]

Build a standalone \`garden\` executable using esbuild + Node SEA.
`);
      process.exit(0);
    }
    fail(`Unknown option: ${arg}`);
  }

  return options;
}

async function main() {
  if (process.platform !== "darwin") {
    fail("Standalone Garden CLI packaging currently supports macOS only.");
  }

  const options = parseArgs(process.argv.slice(2));
  const outputPath = options.output;
  const outputDir = path.dirname(outputPath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-sea-"));
  const bundlePath = path.join(tempDir, "garden-cli.cjs");
  const configPath = path.join(tempDir, "sea-config.json");
  const blobPath = path.join(tempDir, "garden.blob");
  const postjectPath = path.resolve("node_modules/.bin/postject");

  fs.mkdirSync(outputDir, { recursive: true });

  await build({
    entryPoints: ["src/cli.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    outfile: bundlePath,
    logLevel: "info",
    banner: {
      js: "process.env.NODE_NO_WARNINGS ||= '1';"
    }
  });

  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  run(process.execPath, ["--experimental-sea-config", configPath]);

  fs.copyFileSync(process.execPath, outputPath);
  fs.chmodSync(outputPath, 0o755);

  runBestEffort("codesign", ["--remove-signature", outputPath], { stdio: "ignore" });
  run(postjectPath, [
    outputPath,
    SEA_RESOURCE_NAME,
    blobPath,
    "--sentinel-fuse",
    SEA_SENTINEL,
    "--macho-segment-name",
    SEA_SEGMENT
  ]);
  run("codesign", ["--sign", "-", outputPath]);

  if (options.smokeTest) {
    run(outputPath, ["help"]);
  }

  console.log(`Standalone Garden CLI created at ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

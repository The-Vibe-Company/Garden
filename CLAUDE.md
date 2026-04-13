# Garden — Agent Instructions

`AGENTS.md` should be a symlink to this file so Claude Code, Codex, and other agents read the same repo instructions.

## What this repo is

Garden is a deterministic local runtime around Granite.

It is intentionally **not** an LLM product.

Garden owns:
- attention queue state
- workflow scheduling and execution
- webhook ingestion
- MCP and CLI surfaces
- local notifications

Garden does **not** own:
- long-term knowledge storage (`Granite` does)
- agent reasoning itself (`Codex` is an external worker when needed)

## Repository shape

```text
src/        TypeScript source for CLI, MCP server, runtime, db, workflows
test/       Node test suite, including MCP smoke tests
examples/   Example config, payloads, launchd scaffolding
scripts/    Build helpers
dist/       Compiled output used by the linked CLI and Codex MCP config
```

## Core rules

- Keep Garden deterministic. Do not add features that require an LLM for the system to function.
- Treat Codex as an optional executor. Garden must still behave correctly if Codex is unavailable or a workflow fails.
- Keep the MCP surface stable unless there is a strong reason to change it. Existing tool names are part of the public interface.
- Prefer adding runtime behavior in `src/` over burying logic in docs or prompts.
- If you change the CLI or MCP server, keep `garden mcp` working from the compiled build in `dist/src/cli.js`.

## Working conventions

- Source lives in TypeScript under `src/`.
- Build and validation:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
- The linked global `garden` command uses the compiled build, not the TS sources.
- Codex MCP config should point to:
  - Node: `/Users/stan/.nvm/versions/node/v22.17.0/bin/node`
  - CLI: `/Users/stan/Vibe/plans/garden/dist/src/cli.js`

## MCP notes

- Garden uses the official MCP SDK over stdio.
- Keep the MCP server compatible with Codex Desktop expectations:
  - stdio transport
  - stable tool names
  - lightweight resources/prompts are acceptable when they improve discovery
- If MCP behavior changes, rerun the MCP smoke test before considering the work done.

## Tests that matter

Before you consider Garden changes complete, verify:

1. `npm test`
2. `npm run typecheck`
3. `npm run build`
4. `garden help`

If the change touches MCP behavior, also verify that:

1. `codex mcp get garden` still points to `dist/src/cli.js`
2. `garden_get_today` still works over MCP

## Product constraints

- Garden is a personal ops runtime, not a generic task platform.
- The attention queue is the main human-facing abstraction.
- Avoid inflating the scope with broad product surfaces unless they directly support:
  - scheduled work
  - event-driven work
  - attention routing
  - Granite integration

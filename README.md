# Garden

Garden is a deterministic local runtime for running a personal operations layer around Granite.

It is intentionally **not** an LLM product.

Garden does four things:

- runs scheduled workflows
- accepts webhook events
- maintains a local attention queue
- calls external workers such as `codex` when a workflow needs them

Granite stays the durable memory system. Garden owns timing, execution, state, and notifications.

## Principles

- **No mandatory LLM dependency**. Garden works without any model.
- **Codex is an optional worker**. Garden can call `codex`, but it does not depend on it to exist.
- **Deterministic core**. Scheduling, routing, state, notifications, and attention items are local and explicit.
- **Granite is memory, not orchestration**. Garden never tries to turn Granite into a scheduler.
- **Attention is first-class**. Workflows can create actionable items for a human or an agent.

## What V0 Includes

- a local SQLite runtime store
- a CLI for attention items, workflows, and daily recap
- a minimal daemon with:
  - scheduled workflow ticks
  - webhook ingestion
  - macOS notifications
- a Codex executor step
- an MCP server so agents can add or resolve attention items

## What V0 Does Not Include

- a macOS app
- OAuth flows for Gmail or other sources
- a full visual workflow editor
- a built-in Granite integration layer

Those can sit on top later.

## Install

```bash
git clone https://github.com/The-Vibe-Company/Garden.git
cd Garden
```

Node 22+ is required because V0 uses the built-in `node:sqlite` module.

Install dependencies:

```bash
npm install
```

Build the local CLI:

```bash
npm run build
```

Install the `garden` command globally on your machine:

```bash
npm run install:local
garden help
```

If you already ran `npm install` and just want to refresh the global link after changes:

```bash
npm run link
garden help
```

## Quick Start

Before linking globally, you can run the CLI directly from source during development:

```bash
npm start -- help
```

Initialize your local config:

```bash
garden init
```

This writes `~/.garden/config.json`.

Show the current recap:

```bash
garden today
```

Create an attention item manually:

```bash
garden attention add \
  --type reply_needed \
  --title "Reply to Monka about MVP priorities" \
  --body "Draft is ready in Granite." \
  --priority high \
  --notify
```

Run the daemon:

```bash
garden daemon
```

Emit a local event for testing:

```bash
garden webhook emit transcript.completed \
  --payload-file ./examples/transcript-event.json
```

Start the MCP server:

```bash
garden mcp
```

## Architecture

### Layers

- **Garden daemon**
  - schedules workflows
  - receives webhooks
  - writes workflow runs
  - creates notifications
- **Garden CLI**
  - human and script entry point
- **Garden MCP server**
  - agent entry point
- **Granite**
  - durable notes, syntheses, outputs
- **Codex**
  - optional execution worker for specific steps

### Local State

Garden stores runtime state in:

```text
~/.garden/garden.db
```

The database contains:

- `attention_items`
- `workflow_runs`
- `events`
- `schedule_cursors`

### Workflow Model

Workflows are configured in `~/.garden/config.json`.

Each workflow has:

- an `id`
- one or more `triggers`
- a list of `steps`

Supported triggers in V0:

- `schedule` with a 5-field cron expression
- `webhook` with an event name

Supported steps in V0:

- `codex.exec`
- `attention.create`
- `notify.macos`

## Example Config

V0 ships with an example config at [examples/garden.config.json](./examples/garden.config.json).

Example scheduled workflow:

```json
{
  "id": "vault-garden",
  "triggers": [
    { "type": "schedule", "cron": "0 */4 * * *" }
  ],
  "steps": [
    {
      "type": "codex.exec",
      "cwd": "{{env.HOME}}/Vibe",
      "prompt": "Run /vibe_vault-garden focus=all against the Granite vault at {{config.vaultPath}}. Make only high-confidence changes and report what changed."
    }
  ]
}
```

Example webhook-driven workflow:

```json
{
  "id": "ingest-transcript",
  "triggers": [
    { "type": "webhook", "event": "transcript.completed" }
  ],
  "steps": [
    {
      "type": "codex.exec",
      "cwd": "{{env.HOME}}/Vibe",
      "prompt": "Use /vibe_meeting-digest. A transcript is ready for ingestion.\n\nPayload:\n{{json payload}}"
    },
    {
      "type": "attention.create",
      "attention": {
        "type": "review_needed",
        "title": "Review transcript ingest for {{payload.title}}",
        "body": "Workflow ingest-transcript finished. Check the generated note or draft follow-up.",
        "priority": "medium",
        "dedupeKey": "transcript-review:{{payload.id}}",
        "source": "workflow:ingest-transcript"
      },
      "notify": true
    }
  ]
}
```

## CLI

### Recap

```bash
garden today
garden today --json
```

### Attention Queue

```bash
garden attention add --type todo --title "Review digest"
garden attention list
garden attention resolve 12
garden attention snooze 12 --until 2026-04-12T09:00:00+02:00
```

### Workflows

```bash
garden tick
garden workflow run vault-garden
garden webhook emit transcript.completed --payload-file ./examples/transcript-event.json
garden daemon
```

### MCP

```bash
garden mcp
```

Exposed MCP tools in V0:

- `garden_add_attention_item`
- `garden_list_attention_items`
- `garden_resolve_attention_item`
- `garden_snooze_attention_item`
- `garden_get_today`
- `garden_run_workflow`
- `garden_emit_event`

Example Codex MCP config:

```toml
[mcp.garden]
command = "/absolute/path/to/garden"
args = ["mcp", "--config", "~/.garden/config.json"]
```

You can find the installed command path with:

```bash
which garden
```

## launchd

V0 expects macOS scheduling to be external.

Use `launchd` to run:

```bash
garden tick
```

every minute, or just run `garden daemon` on login.

An example launch agent is in [examples/com.stangirard.garden.daemon.plist](./examples/com.stangirard.garden.daemon.plist).

## Testing

```bash
npm run check
```

## Roadmap

- native macOS app
- richer workflow step types
- Gmail/source connectors
- Granite-specific built-in steps
- SQLite-backed MCP resources

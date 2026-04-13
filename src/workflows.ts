import { matchesCron } from "./cron.js";
import {
  createAttentionItem,
  finishWorkflowRun,
  getScheduleCursor,
  recordEvent,
  setScheduleCursor,
  startWorkflowRun
} from "./db.js";
import { minuteCursorKey, nowIso } from "./env.js";
import { notifyMacos } from "./notifier.js";
import { renderTemplate } from "./template.js";
import { runCodexTask } from "./codex.js";
import type { AttentionItemInput, CodexExecStep, GardenConfig, NotifyMacosStep, RunWorkflowResult, WorkflowDefinition, WorkflowEvent } from "./types.js";

function parseMinuteCursor(cursor: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(cursor);
  if (!match) {
    throw new Error(`Invalid schedule cursor: ${cursor}`);
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function scheduledCursorRange(lastCursor: string | null, currentCursor: string) {
  if (!lastCursor) {
    return [currentCursor];
  }

  if (lastCursor >= currentCursor) {
    return [];
  }

  const cursors = [];
  let next = addMinutes(parseMinuteCursor(lastCursor), 1);
  const end = parseMinuteCursor(currentCursor);

  while (next <= end) {
    cursors.push(minuteCursorKey(next));
    next = addMinutes(next, 1);
  }

  return cursors;
}

function buildContext({ config, workflow, event, trigger, run }) {
  return {
    config,
    workflow,
    trigger,
    event,
    payload: event?.payload ?? {},
    env: process.env,
    run
  };
}

async function executeStep({ db, step, context, codexConfig }) {
  if (step.type === "codex.exec") {
    const rendered = renderTemplate(step, context) as CodexExecStep & { codex?: Record<string, unknown> };
    const result = await runCodexTask({
      codexConfig: {
        ...codexConfig,
        ...(rendered.codex ?? {})
      },
      prompt: rendered.prompt,
      cwd: rendered.cwd,
      workflowId: context.workflow.id
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Codex step failed in workflow ${context.workflow.id}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`
      );
    }

    return {
      type: step.type,
      ok: true,
      cwd: rendered.cwd,
      promptPreview: rendered.prompt.slice(0, 160),
      finalMessage: result.finalMessage
    };
  }

  if (step.type === "attention.create") {
    const rendered = renderTemplate(step.attention ?? {}, context) as AttentionItemInput;
    const item = createAttentionItem(db, rendered);
    if (step.notify) {
      await notifyMacos({
        title: `Garden: ${item.type}`,
        subtitle: item.priority,
        body: item.title
      });
    }
    return {
      type: step.type,
      ok: true,
      attentionItemId: item.id
    };
  }

  if (step.type === "notify.macos") {
    const rendered = renderTemplate(step, context) as NotifyMacosStep;
    await notifyMacos({
      title: rendered.title ?? "Garden",
      subtitle: rendered.subtitle ?? "",
      body: rendered.body ?? ""
    });
    return {
      type: step.type,
      ok: true
    };
  }

  throw new Error(`Unsupported workflow step type: ${step.type}`);
}

export async function runWorkflow({ db, config, workflow, triggerType, triggerValue, event }): Promise<RunWorkflowResult> {
  const start = startWorkflowRun(db, {
    workflowId: workflow.id,
    triggerType,
    triggerValue,
    details: {
      eventType: event?.type ?? null
    }
  });

  if (start.skipped) {
    return {
      skipped: true,
      run: start.run
    };
  }

  const context = buildContext({
    config,
    workflow,
    event,
    trigger: {
      type: triggerType,
      value: triggerValue
    },
    run: start.run
  });

  const stepResults = [];

  try {
    for (const step of workflow.steps ?? []) {
      const result = await executeStep({
        db,
        step,
        context,
        codexConfig: config.codex ?? {}
      });
      stepResults.push(result);
    }

    const finished = finishWorkflowRun(db, start.run.id, {
      status: "success",
      summary: `Workflow ${workflow.id} completed successfully.`,
      details: {
        executedAt: nowIso(),
        stepResults
      }
    });
    return {
      skipped: false,
      run: finished
    };
  } catch (error) {
    createAttentionItem(db, {
      type: "failed_run",
      title: `Workflow failed: ${workflow.id}`,
      body: error.message,
      priority: "high",
      dedupeKey: `failed-run:${workflow.id}`,
      source: `workflow:${workflow.id}`,
      metadata: {
        triggerType,
        triggerValue,
        runId: start.run.id
      }
    });

    const finished = finishWorkflowRun(db, start.run.id, {
      status: "failed",
      summary: error.message,
      details: {
        executedAt: nowIso(),
        stepResults
      }
    });

    return {
      skipped: false,
      run: finished,
      error
    };
  }
}

export async function processEvent({ db, config, eventType, payload, source = "garden" }) {
  const event = recordEvent(db, {
    eventType,
    payload,
    source
  });

  const matchingWorkflows = (config.workflows ?? []).filter(
    (workflow) =>
      workflow.enabled !== false &&
      Array.isArray(workflow.triggers) &&
      workflow.triggers.some((trigger) => trigger.type === "webhook" && trigger.event === eventType)
  );

  const runs = [];
  for (const workflow of matchingWorkflows) {
    runs.push(
      await runWorkflow({
        db,
        config,
        workflow,
        triggerType: "webhook",
        triggerValue: eventType,
        event: {
          type: eventType,
          payload
        }
      })
    );
  }

  return {
    event,
    runs
  };
}

export async function tickScheduledWorkflows({ db, config, now = new Date() }) {
  const cursor = minuteCursorKey(now);
  const runs = [];

  for (const workflow of config.workflows ?? []) {
    if (workflow.enabled === false) {
      continue;
    }

    const scheduleTriggers = (workflow.triggers ?? []).filter((trigger) => trigger.type === "schedule");
    const dueCursors = scheduledCursorRange(getScheduleCursor(db, workflow.id), cursor);

    for (const dueCursor of dueCursors) {
      const dueDate = parseMinuteCursor(dueCursor);
      const matchedTrigger = scheduleTriggers.find((trigger) => matchesCron(dueDate, trigger.cron));
      if (!matchedTrigger) {
        continue;
      }

      const result = await runWorkflow({
        db,
        config,
        workflow,
        triggerType: "schedule",
        triggerValue: matchedTrigger.cron,
        event: {
          type: "schedule.tick",
          payload: {
            cron: matchedTrigger.cron,
            cursor: dueCursor
          }
        }
      });

      if (result.skipped) {
        break;
      }

      setScheduleCursor(db, workflow.id, dueCursor);
      runs.push(result);
    }
  }

  return {
    cursor,
    runs
  };
}

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
    for (const trigger of scheduleTriggers) {
      if (!matchesCron(now, trigger.cron)) {
        continue;
      }
      const lastCursor = getScheduleCursor(db, workflow.id);
      if (lastCursor === cursor) {
        continue;
      }
      setScheduleCursor(db, workflow.id, cursor);
      runs.push(
        await runWorkflow({
          db,
          config,
          workflow,
          triggerType: "schedule",
          triggerValue: trigger.cron,
          event: {
            type: "schedule.tick",
            payload: {
              cron: trigger.cron,
              cursor
            }
          }
        })
      );
    }
  }

  return {
    cursor,
    runs
  };
}

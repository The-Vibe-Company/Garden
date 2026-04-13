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
import type {
  AttentionItemInput,
  CodexExecStep,
  GardenConfig,
  NotifyMacosStep,
  RunWorkflowResult,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRunEventSink,
  WorkflowRunStreamEvent
} from "./types.js";

function buildContext({ config, workflow, event, trigger, run, onEvent, stepIndex = 0 }) {
  return {
    config,
    workflow,
    trigger,
    event,
    payload: event?.payload ?? {},
    env: process.env,
    run,
    onEvent,
    stepIndex
  };
}

async function executeStep({ db, step, context, codexConfig }) {
  if (!context.run?.id) {
    throw new Error(`Workflow run context is missing a run id for ${context.workflow.id}`);
  }

  const baseEvent = {
    workflowId: context.workflow.id,
    runId: context.run.id
  };

  await emitWorkflowEvent(context.onEvent, {
    type: "step.started",
    ...baseEvent,
    at: nowIso(),
    stepIndex: context.stepIndex,
    stepType: step.type
  });

  try {
    if (step.type === "codex.exec") {
    const rendered = renderTemplate(step, context) as CodexExecStep & { codex?: Record<string, unknown> };
    await emitWorkflowEvent(context.onEvent, {
      type: "codex.started",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      cwd: rendered.cwd ?? null,
      promptPreview: rendered.prompt.slice(0, 160)
    });
    const result = await runCodexTask({
      codexConfig: {
        ...codexConfig,
        ...(rendered.codex ?? {})
      },
      prompt: rendered.prompt,
      cwd: rendered.cwd,
      workflowId: context.workflow.id,
      onStdout: async (text) => {
        await emitWorkflowEvent(context.onEvent, {
          type: "codex.stdout",
          ...baseEvent,
          at: nowIso(),
          stepIndex: context.stepIndex,
          text
        });
      },
      onStderr: async (text) => {
        await emitWorkflowEvent(context.onEvent, {
          type: "codex.stderr",
          ...baseEvent,
          at: nowIso(),
          stepIndex: context.stepIndex,
          text
        });
      },
      onFinalMessage: async (text) => {
        if (!text) {
          return;
        }
        await emitWorkflowEvent(context.onEvent, {
          type: "codex.final_message",
          ...baseEvent,
          at: nowIso(),
          stepIndex: context.stepIndex,
          text
        });
      }
    });

    await emitWorkflowEvent(context.onEvent, {
      type: "codex.completed",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      exitCode: result.exitCode,
      ok: result.ok
    });

    if (!result.ok) {
      const failureDetail =
        result.failureMessage ??
        [result.stderr, result.stdout, result.finalMessage]
          .map((value) => value.trim())
          .find((value) => value.length > 0) ??
        `exit ${result.exitCode}`;
      throw new Error(
        `Codex step failed in workflow ${context.workflow.id}: ${failureDetail}`
      );
    }

    const eventResult = {
      type: step.type,
      ok: true,
      cwd: rendered.cwd,
      promptPreview: rendered.prompt.slice(0, 160),
      finalMessage: result.finalMessage
    };

    await emitWorkflowEvent(context.onEvent, {
      type: "step.completed",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      stepType: step.type,
      ok: true,
      result: eventResult
    });

    return eventResult;
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
    const eventResult = {
      type: step.type,
      ok: true,
      attentionItemId: item.id
    };

    await emitWorkflowEvent(context.onEvent, {
      type: "step.completed",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      stepType: step.type,
      ok: true,
      result: eventResult
    });

    return eventResult;
    }

    if (step.type === "notify.macos") {
    const rendered = renderTemplate(step, context) as NotifyMacosStep;
    await notifyMacos({
      title: rendered.title ?? "Garden",
      subtitle: rendered.subtitle ?? "",
      body: rendered.body ?? ""
    });
    const eventResult = {
      type: step.type,
      ok: true
    };

    await emitWorkflowEvent(context.onEvent, {
      type: "step.completed",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      stepType: step.type,
      ok: true,
      result: eventResult
    });

    return eventResult;
    }

    throw new Error(`Unsupported workflow step type: ${step.type}`);
  } catch (error) {
    await emitWorkflowEvent(context.onEvent, {
      type: "step.failed",
      ...baseEvent,
      at: nowIso(),
      stepIndex: context.stepIndex,
      stepType: step.type,
      ok: false,
      message: error.message
    });
    throw error;
  }
}

async function emitWorkflowEvent(onEvent: WorkflowRunEventSink | undefined, event: WorkflowRunStreamEvent) {
  if (!onEvent) {
    return;
  }
  await onEvent(event);
}

export async function runWorkflow({
  db,
  config,
  workflow,
  triggerType,
  triggerValue,
  event,
  onEvent
}: {
  db: any;
  config: GardenConfig;
  workflow: WorkflowDefinition;
  triggerType: string;
  triggerValue: string | null;
  event: WorkflowEvent | undefined;
  onEvent?: WorkflowRunEventSink;
}): Promise<RunWorkflowResult> {
  const start = startWorkflowRun(db, {
    workflowId: workflow.id,
    triggerType,
    triggerValue,
    details: {
      eventType: event?.type ?? null
    }
  });

  if (start.skipped) {
    await emitWorkflowEvent(onEvent, {
      type: "run.skipped",
      workflowId: workflow.id,
      runId: start.run.id,
      at: nowIso(),
      run: start.run,
      skipped: true,
      message: `Workflow ${workflow.id} is already running.`
    });
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
    run: start.run,
    onEvent,
    stepIndex: 0
  });

  const stepResults = [];

  await emitWorkflowEvent(onEvent, {
    type: "run.started",
    workflowId: workflow.id,
    runId: start.run.id,
    at: nowIso(),
    run: start.run
  });

  try {
    for (const [stepIndex, step] of (workflow.steps ?? []).entries()) {
      const result = await executeStep({
        db,
        step,
        context: {
          ...context,
          stepIndex
        },
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

    await emitWorkflowEvent(onEvent, {
      type: "run.completed",
      workflowId: workflow.id,
      runId: finished.id,
      at: nowIso(),
      skipped: false,
      run: finished
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

    await emitWorkflowEvent(onEvent, {
      type: "run.completed",
      workflowId: workflow.id,
      runId: finished.id,
      at: nowIso(),
      skipped: false,
      run: finished
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

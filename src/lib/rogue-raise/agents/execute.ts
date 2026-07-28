/**
 * The agent runner — composes the catalog gate, the run lifecycle, and the
 * registered handler.
 *
 * Shape, and why: the handler runs **outside** any transaction, because it makes
 * network calls that can take minutes. So a run is three steps —
 *
 *   1. transaction: gate on `Event.status`, insert the run as `running`
 *   2. no transaction: invoke the handler
 *   3. transaction: write assets + finish the run
 *
 * — and a crash between 1 and 3 is exactly the case `reclaimStaleRuns` exists
 * for. The `AgentRun` row is what makes an interrupted run recoverable at all.
 *
 * ## The durable-workflow seam (PRD §3, §11.1)
 *
 * Long, multi-step agents are specified to run as **durable Vercel Workflows**
 * so they survive the function timeout and can pause for review and resume.
 * Vercel Workflows cannot execute outside Vercel, so this module ships the
 * INLINE executor and the record-keeping a durable one needs; it does not
 * pretend to be durable. `runAgent` is the seam: a WDK adapter replaces the
 * body of step 2 with a durable step, and steps 1 and 3 are unchanged.
 *
 * Until then an agent is bounded by the request timeout (~300s on Fluid
 * Compute). That is fine while no agent is long, and is why the first genuinely
 * long agent (M4, context research → repo) owns wiring WDK.
 */
import { getAiAdapter } from "../integrations/ai-gateway";
import { getAgentDefinition, type AgentType } from "./catalog";
import { getAgentHandler } from "./registry";
import {
  AgentNotTriggerableError,
  finishRun,
  startRun,
  type FinishedRun,
} from "./runs";

export interface RunAgentInput {
  eventId: string;
  type: AgentType;
  inputs?: Record<string, unknown>;
  /** Set when re-running; the new run records its parent for the audit chain. */
  parentRunId?: string;
  /** Extra steer for a re-run, passed through to the handler. */
  additionalInstructions?: string;
}

export type RunAgentOutcome =
  | { ok: true; runId: string; assetIds: string[]; costTokens: number }
  | { ok: false; runId?: string; reason: string };

/**
 * Run one agent to completion. Never throws for an expected failure — a refused
 * trigger, a handler crash, and a secret in the output all come back as
 * `{ok: false}` with a reason, and (except for the refusal, which happens before
 * a run exists) leave a `failed` run row carrying the details.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentOutcome> {
  const definition = getAgentDefinition(input.type);
  if (!definition) {
    return { ok: false, reason: `Unknown agent type "${input.type}".` };
  }

  const handler = getAgentHandler(input.type);
  if (!handler) {
    return {
      ok: false,
      reason: `"${definition.label}" isn't implemented yet.`,
    };
  }

  // --- 1. Gate + create the run ---
  let started;
  try {
    started = await startRun(input);
  } catch (err) {
    if (err instanceof AgentNotTriggerableError) {
      return { ok: false, reason: err.message };
    }
    console.error("[agents] failed to start run", err);
    return { ok: false, reason: "Couldn't start that agent. Please try again." };
  }

  // --- 2. Run the handler (outside any transaction) ---
  const logLines: string[] = [];
  const log = (message: string) => {
    logLines.push(message);
  };
  log(`Started ${definition.label} for ${started.event.title}.`);

  const ai = getAiAdapter();
  if (ai.provider === "dev") {
    log("No AI provider configured — using the placeholder dev provider.");
  }

  let result;
  try {
    result = await handler({
      runId: started.runId,
      event: started.event,
      inputs: input.inputs ?? {},
      additionalInstructions: input.additionalInstructions,
      ai,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed: ${message}`);
    await recordFailure(started.runId, started.event.id, input.type, logLines, message);
    return { ok: false, runId: started.runId, reason: message };
  }

  if (result.summary) log(result.summary);
  log(`Produced ${result.assets.length} asset(s).`);

  // --- 3. Persist assets + finish ---
  const costTokens = result.costTokens ?? 0;
  let finished: FinishedRun;
  try {
    finished = await finishRun({
      runId: started.runId,
      eventId: started.event.id,
      agentType: input.type,
      status: "succeeded",
      logs: logLines.join("\n"),
      costTokens,
      assets: result.assets,
    });
  } catch (err) {
    // A rejected asset (undeclared type, or credential material) fails the run —
    // the transaction rolled back, so nothing partial was stored.
    const message = err instanceof Error ? err.message : String(err);
    log(`Refused to store output: ${message}`);
    await recordFailure(
      started.runId,
      started.event.id,
      input.type,
      logLines,
      message,
      costTokens,
    );
    return { ok: false, runId: started.runId, reason: message };
  }

  return {
    ok: true,
    runId: finished.runId,
    assetIds: finished.assetIds,
    costTokens,
  };
}

async function recordFailure(
  runId: string,
  eventId: string,
  agentType: string,
  logLines: string[],
  error: string,
  costTokens = 0,
): Promise<void> {
  try {
    await finishRun({
      runId,
      eventId,
      agentType,
      status: "failed",
      logs: logLines.join("\n"),
      costTokens,
      error,
    });
  } catch (err) {
    // The run row is the incident report; losing it would hide the failure.
    console.error("[agents] failed to record run failure", err);
  }
}

/**
 * Re-run an agent with extra instructions. A NEW run is created — the previous
 * attempt and its assets are left intact, because the chain of attempts is the
 * audit trail (PRD §11.2: "each agent is independently re-runnable with
 * additional instructions").
 */
export async function rerunAgent(input: {
  eventId: string;
  type: AgentType;
  previousRunId: string;
  additionalInstructions?: string;
  inputs?: Record<string, unknown>;
}): Promise<RunAgentOutcome> {
  return runAgent({
    eventId: input.eventId,
    type: input.type,
    inputs: input.inputs,
    parentRunId: input.previousRunId,
    additionalInstructions: input.additionalInstructions,
  });
}

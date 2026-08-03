/**
 * Chooses how an agent run executes: durably, or inline.
 *
 * This is the seam PRD §3 and §11.1 ask for. It exists as its own module so
 * there is exactly one place that answers "is this run durable?", and so callers
 * never have to know.
 *
 * **Inline is the default, deliberately.** The Workflow DevKit needs its own
 * runtime (`next dev` with the plugin, or a Vercel deployment); on a laptop
 * without it, `start()` fails. Defaulting to durable would mean the app worked
 * in production and not on the machine of whoever is building it, which is the
 * wrong way round for a codebase that is handed to someone else to finish.
 *
 * **A failed dispatch falls back rather than failing the run.** If the workflow
 * runtime is enabled but unreachable, running the agent inline is strictly
 * better than telling staff their agent didn't start — the worst case is that a
 * long run hits the request timeout, which is exactly where it was before.
 */
import type { RunAgentInput, RunAgentOutcome } from "./execute";

export type DispatchMode = "durable" | "inline";

export function dispatchMode(): DispatchMode {
  return process.env.RR_WORKFLOWS_ENABLED === "true" ? "durable" : "inline";
}

export interface DispatchResult {
  mode: DispatchMode;
  /**
   * Present when the run executed here and now. A durable dispatch returns
   * without one: the run is in flight, and its `AgentRun` row is how the
   * console tracks it — which is the same mechanism `reclaimStaleRuns` and the
   * agents page already use, so nothing downstream needs to change.
   */
  outcome?: RunAgentOutcome;
  runId?: string;
  /** Set when durable dispatch was attempted and we fell back. */
  fellBackBecause?: string;
}

export async function dispatchAgentRun(
  input: RunAgentInput,
): Promise<DispatchResult> {
  const { runAgent } = await import("./execute");

  if (dispatchMode() === "inline") {
    return { mode: "inline", outcome: await runAgent(input) };
  }

  try {
    // Imported lazily: `workflow/api` reaches for its runtime at import time,
    // and an inline deployment must not pay that cost or risk that failure.
    const [{ start }, { agentRunWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("./workflow"),
    ]);
    const run = await start(agentRunWorkflow, [input]);
    return { mode: "durable", runId: run.runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agents] durable dispatch failed; running inline", err);
    return {
      mode: "inline",
      outcome: await runAgent(input),
      fellBackBecause: message,
    };
  }
}

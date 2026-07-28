"use workflow";

/**
 * The durable agent run (PRD §3, §11.1: *"Long/multi-step agent runs MUST use
 * durable Vercel Workflows (WDK) so they survive the timeout and can pause for
 * human review and resume with feedback"*).
 *
 * ## Why this file exists separately from `execute.ts`
 *
 * `execute.ts` runs an agent inline, inside the request. That is correct and
 * simple, and it is bounded by the function timeout (~300s on Fluid Compute).
 * The context-research agent drafts four long documents and then checks every
 * citation over the network; it is the one that will eventually exceed that.
 *
 * A workflow is not "the same code, but slower". The `"use workflow"` directive
 * above makes this function's execution durable: each `"use step"` call is
 * checkpointed, so a run that is interrupted resumes from the last completed
 * step rather than starting over — which matters when step 2 has already spent
 * real money on model tokens.
 *
 * ## What is deliberately NOT here
 *
 * The human review pause. It would be natural to model "wait for the admin to
 * approve" as a workflow hook, and WDK supports exactly that. This app already
 * implements that pause **in the database**: the run finishes, its assets are
 * `pending`, and the admin console resumes the process whenever someone gets to
 * it — days later, across deploys, surviving anything a workflow's own
 * durability would survive. Modelling it twice would mean a workflow run held
 * open for days AND a database row, with two ways to disagree about the state.
 *
 * So the durable boundary is the *execution* of the agent, not the review.
 *
 * ## Running this
 *
 * WDK needs its runtime — `next dev` with the plugin, or a Vercel deployment.
 * `dispatch.ts` chooses between this and the inline executor, and defaults to
 * inline so that a laptop with no workflow runtime still runs every agent.
 */
import { runAgent, type RunAgentInput, type RunAgentOutcome } from "./execute";

/**
 * One step, not three.
 *
 * `runAgent` already owns the gate → run → persist sequence and its own
 * transactions; splitting it across `"use step"` boundaries here would duplicate
 * that sequencing in a second place and let the two drift. What the workflow
 * adds is that this call is checkpointed and retried as a unit, and that the
 * enclosing function is not bounded by a request.
 */
async function executeAgent(input: RunAgentInput): Promise<RunAgentOutcome> {
  "use step";
  return runAgent(input);
}

export async function agentRunWorkflow(
  input: RunAgentInput,
): Promise<RunAgentOutcome> {
  return executeAgent(input);
}

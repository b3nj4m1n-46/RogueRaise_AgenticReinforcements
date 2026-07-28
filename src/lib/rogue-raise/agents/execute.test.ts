/**
 * Integration tests for the agent runner against a REAL local Postgres.
 *
 * The handler under test is registered through the same registry the real
 * agents use, so what's exercised here is exactly the path production takes —
 * only the handler body is a test double.
 */
import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import {
  agentRuns,
  auditLog,
  events,
  generatedAssets,
  organizations,
} from "../db/schema";
import { DEV_ASSET_BANNER, resetAiAdapter } from "../integrations/ai-gateway";
import { runAgent, rerunAgent } from "./execute";
import {
  registerAgentHandler,
  unregisterAgentHandler,
  type AgentContext,
  type AgentResult,
} from "./registry";
import { reclaimStaleRuns, totalCostForEvent } from "./runs";

// The agent we drive. `context_research_repo` is used because it declares
// several asset types and triggers on `intake_complete`.
const AGENT = "context_research_repo" as const;

const createdOrgIds: string[] = [];

async function createEvent(status = "intake_complete"): Promise<string> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Agent Test Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      slug: `agent-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: status as "intake_complete",
    })
    .returning({ id: events.id });
  return event.id;
}

async function runsFor(eventId: string) {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.eventId, eventId))
    .orderBy(agentRuns.createdAt);
}

async function assetsFor(eventId: string) {
  return db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.eventId, eventId))
    .orderBy(generatedAssets.version);
}

async function auditActions(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.eventId, eventId))
    .orderBy(auditLog.createdAt);
  return rows.map((r) => r.action);
}

beforeEach(() => {
  resetAiAdapter();
});

afterEach(() => {
  unregisterAgentHandler(AGENT);
});

afterAll(async () => {
  if (createdOrgIds.length) {
    const eventIds = (
      await db
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.orgId, createdOrgIds))
    ).map((e) => e.id);
    if (eventIds.length) {
      await db.delete(generatedAssets).where(inArray(generatedAssets.eventId, eventIds));
      await db.delete(agentRuns).where(inArray(agentRuns.eventId, eventIds));
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("runAgent — happy path", () => {
  it("records the run, versions the asset, and leaves it pending review", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async (ctx) => {
      ctx.log("looked at the intake");
      return {
        assets: [{ type: "research_doc", title: "Research", body: "Findings." }],
        costTokens: 1234,
        summary: "drafted one document",
      };
    });

    const outcome = await runAgent({ eventId, type: AGENT, inputs: { depth: "quick" } });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assetIds).toHaveLength(1);
    expect(outcome.costTokens).toBe(1234);

    const [run] = await runsFor(eventId);
    expect(run.status).toBe("succeeded");
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(run.costTokens).toBe(1234);
    expect(run.logs).toContain("looked at the intake");
    expect(run.logs).toContain("drafted one document");
    expect(run.inputs).toMatchObject({ depth: "quick", triggeredAtStatus: "intake_complete" });

    const [asset] = await assetsFor(eventId);
    expect(asset.agentRunId).toBe(run.id); // attribution
    expect(asset.version).toBe(1);
    expect(asset.reviewStatus).toBe("pending"); // nothing auto-publishes

    const actions = await auditActions(eventId);
    expect(actions).toEqual(["agent_run.running", "agent_run.succeeded"]);
  });

  it("uses the labelled dev provider when no AI credentials are configured", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async (ctx) => {
      const result = await ctx.ai.generate({ prompt: "Summarize the problem." });
      return {
        assets: [{ type: "research_doc", body: result.text }],
        costTokens: result.usage.totalTokens,
      };
    });

    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(true);
    const [asset] = await assetsFor(eventId);
    // A placeholder must be unmistakable in a review queue.
    expect(asset.body).toContain(DEV_ASSET_BANNER);
    const [run] = await runsFor(eventId);
    expect(run.logs).toContain("placeholder dev provider");
    expect(run.costTokens).toBeGreaterThan(0);
  });

  it("totals cost across every run for the event", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [{ type: "research_doc", body: "x" }],
      costTokens: 100,
    }));

    await runAgent({ eventId, type: AGENT });
    await runAgent({ eventId, type: AGENT });

    expect(await totalCostForEvent(eventId)).toBe(200);
  });
});

describe("runAgent — re-running", () => {
  it("creates a new run at version N+1 and keeps the first attempt", async () => {
    const eventId = await createEvent();
    let call = 0;
    registerAgentHandler(AGENT, async (ctx) => {
      call += 1;
      return {
        assets: [
          {
            type: "research_doc",
            body: `attempt ${call}${ctx.additionalInstructions ? ` — ${ctx.additionalInstructions}` : ""}`,
          },
        ],
      };
    });

    const first = await runAgent({ eventId, type: AGENT });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await rerunAgent({
      eventId,
      type: AGENT,
      previousRunId: first.runId,
      additionalInstructions: "Lead with the data gaps.",
    });
    expect(second.ok).toBe(true);

    const runs = await runsFor(eventId);
    expect(runs).toHaveLength(2); // the first attempt survives
    expect(runs[1].inputs).toMatchObject({
      parentRunId: first.runId,
      additionalInstructions: "Lead with the data gaps.",
    });

    const assets = await assetsFor(eventId);
    expect(assets.map((a) => a.version)).toEqual([1, 2]);
    expect(assets[1].body).toContain("Lead with the data gaps.");
    // Each version is attributable to the run that produced it.
    expect(assets[0].agentRunId).not.toBe(assets[1].agentRunId);
  });

  it("versions each asset type independently", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [
        { type: "research_doc", body: "a" },
        { type: "example_prd", body: "b" },
      ],
    }));

    await runAgent({ eventId, type: AGENT });
    await runAgent({ eventId, type: AGENT });

    const assets = await assetsFor(eventId);
    const byType = (type: string) =>
      assets.filter((a) => a.type === type).map((a) => a.version);
    expect(byType("research_doc")).toEqual([1, 2]);
    expect(byType("example_prd")).toEqual([1, 2]);
  });
});

describe("runAgent — refusals and failures", () => {
  it("refuses to run in a phase the agent doesn't declare, before any work", async () => {
    const eventId = await createEvent("registration_open");
    const handler = vi.fn<(ctx: AgentContext) => Promise<AgentResult>>();
    registerAgentHandler(AGENT, handler);

    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/can't run while the event is "registration_open"/);
    expect(handler).not.toHaveBeenCalled();
    expect(await runsFor(eventId)).toHaveLength(0);
    // The blocked trigger is still visible in the log.
    expect(await auditActions(eventId)).toEqual(["agent_run.refused"]);
  });

  it("records a handler crash as a failed run carrying the error and logs", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async (ctx) => {
      ctx.log("got as far as reading the intake");
      throw new Error("the research service timed out");
    });

    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(false);
    const [run] = await runsFor(eventId);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("the research service timed out");
    expect(run.logs).toContain("got as far as reading the intake");
    expect(run.finishedAt).not.toBeNull();
    expect(await assetsFor(eventId)).toHaveLength(0);
    expect(await auditActions(eventId)).toEqual([
      "agent_run.running",
      "agent_run.failed",
    ]);
  });

  it("refuses an asset type the agent never declared", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [{ type: "social_post", body: "off-catalog" }],
    }));

    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/not declared to produce "social_post"/);
    expect(await assetsFor(eventId)).toHaveLength(0);
  });

  it("fails the run rather than storing credential material", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [
        { type: "research_doc", body: "Setup notes." },
        {
          type: "setup_agent_instructions",
          body: "Use ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 to clone.",
        },
      ],
    }));

    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/credential material/);
    expect(outcome.reason).toMatch(/GitHub token/);
    // The whole write rolled back — not even the innocent first document landed.
    expect(await assetsFor(eventId)).toHaveLength(0);

    const [run] = await runsFor(eventId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/credential material/);
    // The refusal message never repeats the secret it found.
    expect(run.error).not.toContain("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
  });

  it("reports an agent with no handler instead of creating a dangling run", async () => {
    const eventId = await createEvent();
    const outcome = await runAgent({ eventId, type: AGENT });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/isn't implemented yet/);
    expect(await runsFor(eventId)).toHaveLength(0);
  });
});

describe("reclaimStaleRuns", () => {
  it("fails a run whose process died, so it isn't stuck running forever", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [{ type: "research_doc", body: "x" }],
    }));
    await runAgent({ eventId, type: AGENT });

    // Simulate a process that died mid-run.
    const [run] = await runsFor(eventId);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db
      .update(agentRuns)
      .set({ status: "running", finishedAt: null, startedAt: longAgo })
      .where(eq(agentRuns.id, run.id));

    const reclaimed = await reclaimStaleRuns(15 * 60 * 1000);
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const [after] = await runsFor(eventId);
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/interrupted/);
    expect(after.finishedAt).not.toBeNull();
  });

  it("leaves a genuinely in-flight run alone", async () => {
    const eventId = await createEvent();
    registerAgentHandler(AGENT, async () => ({
      assets: [{ type: "research_doc", body: "x" }],
    }));
    await runAgent({ eventId, type: AGENT });

    const [run] = await runsFor(eventId);
    await db
      .update(agentRuns)
      .set({ status: "running", finishedAt: null, startedAt: new Date() })
      .where(eq(agentRuns.id, run.id));

    await reclaimStaleRuns(15 * 60 * 1000);

    const [after] = await db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, run.id)));
    expect(after.status).toBe("running");
  });
});

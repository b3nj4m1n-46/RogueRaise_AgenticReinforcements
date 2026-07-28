/**
 * Integration tests for the review gate against a REAL local Postgres.
 * Same harness as the other suites: dotenv first, `next/cache` mocked, DB real.
 */
import "dotenv/config";

import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "../db";
import {
  agentRuns,
  auditLog,
  eventIntakes,
  events,
  generatedAssets,
  organizations,
  sponsorApplications,
} from "../db/schema";
import { initialAdminEventState } from "../events/state";
import {
  editAndApproveAssetAction,
  reviewAssetAction,
  runAgentAction,
} from "./review-actions";

const AGENT = "context_research_repo";
const createdOrgIds: string[] = [];

/** A fully-intaken event — what the context-research agent needs to run. */
async function createIntakenEvent(): Promise<string> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Review Test Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail: `jamie-${suffix}@example.org`,
      pocPhone: "+15415551234",
      painPoints: "Shelter capacity data lives in spreadsheets.",
      goalsNeeds: "One place to see who has beds tonight.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `review-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: "intake_complete",
    })
    .returning({ id: events.id });

  await db.insert(eventIntakes).values({
    eventId: event.id,
    supplementaryInfo: "Five years of nightly bed-count emails.",
    stakeholderTechStack: "Postgres 14 and a Django admin.",
    stakeholderTechTags: ["postgres", "django"],
    completedAt: new Date(),
  });

  return event.id;
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

async function assetsFor(eventId: string) {
  return db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.eventId, eventId))
    .orderBy(generatedAssets.type, generatedAssets.version);
}

async function auditActions(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.eventId, eventId))
    .orderBy(auditLog.createdAt);
  return rows.map((r) => r.action);
}

/** Run the agent and return the newest `research_doc`. */
async function runAndGetDoc(eventId: string) {
  const state = await runAgentAction(
    initialAdminEventState,
    form({ event_id: eventId, agent_type: AGENT }),
  );
  expect(state.ok).toBe(true);
  const [doc] = await db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.eventId, eventId))
    .orderBy(desc(generatedAssets.version))
    .limit(1);
  return doc;
}

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
      await db.delete(eventIntakes).where(inArray(eventIntakes.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("runAgentAction — context research", () => {
  it("drafts all four starter-repo documents, pending review", async () => {
    const eventId = await createIntakenEvent();

    const state = await runAgentAction(
      initialAdminEventState,
      form({ event_id: eventId, agent_type: AGENT }),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).toContain("4 draft(s)");

    const assets = await assetsFor(eventId);
    expect(assets.map((a) => a.type).sort()).toEqual([
      "example_prd",
      "research_doc",
      "setup_agent_instructions",
      "stakeholder_preferences",
    ]);
    for (const asset of assets) {
      expect(asset.version).toBe(1);
      expect(asset.reviewStatus).toBe("pending");
      expect(asset.agentRunId).not.toBeNull();
      // The sponsor's own words reached the document.
      expect(asset.body).toContain("Shelter capacity data lives in spreadsheets.");
    }
  });

  it("refuses to run against an event with no intake", async () => {
    const suffix = crypto.randomUUID();
    const [org] = await db
      .insert(organizations)
      .values({ name: `Review Test Org ${suffix}` })
      .returning({ id: organizations.id });
    createdOrgIds.push(org.id);
    const [event] = await db
      .insert(events)
      .values({
        orgId: org.id,
        slug: `review-test-${suffix}`,
        title: "No intake",
        status: "intake_complete",
      })
      .returning({ id: events.id });

    const state = await runAgentAction(
      initialAdminEventState,
      form({ event_id: event.id, agent_type: AGENT }),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/no intake yet/);
    // The failure is recorded as a run, not lost.
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.eventId, event.id));
    expect(run.status).toBe("failed");
  });

  it("re-runs with extra instructions and keeps the first attempt", async () => {
    const eventId = await createIntakenEvent();
    await runAgentAction(initialAdminEventState, form({ event_id: eventId, agent_type: AGENT }));
    const [firstRun] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.eventId, eventId));

    const state = await runAgentAction(
      initialAdminEventState,
      form({
        event_id: eventId,
        agent_type: AGENT,
        previous_run_id: firstRun.id,
        additional_instructions: "Lead with the data-quality gaps.",
      }),
    );

    expect(state.ok).toBe(true);
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.eventId, eventId));
    expect(runs).toHaveLength(2);

    const docs = (await assetsFor(eventId)).filter((a) => a.type === "research_doc");
    expect(docs.map((d) => d.version)).toEqual([1, 2]);
    // The steer reached the model call.
    expect(docs[1].body).toContain("Lead with the data-quality gaps.");
  });

  it("refuses an unknown agent type", async () => {
    const eventId = await createIntakenEvent();
    const state = await runAgentAction(
      initialAdminEventState,
      form({ event_id: eventId, agent_type: "not_an_agent" }),
    );
    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/not an agent we know about/);
  });
});

describe("reviewAssetAction", () => {
  it("approves a draft and audits the transition", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await reviewAssetAction(
      initialAdminEventState,
      form({ asset_id: doc.id, decision: "approve" }),
    );

    expect(state.ok).toBe(true);
    const [after] = await db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.id, doc.id));
    expect(after.reviewStatus).toBe("approved");
    expect(await auditActions(eventId)).toContain("generated_asset.approved");
  });

  it("stores the note when sending a draft back for edits", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await reviewAssetAction(
      initialAdminEventState,
      form({
        asset_id: doc.id,
        decision: "request_edits",
        note: "Too abstract — name the actual systems.",
      }),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).toMatch(/re-run the agent/);
    const [after] = await db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.id, doc.id));
    expect(after.reviewStatus).toBe("edit_requested");
    expect(after.reviewNote).toBe("Too abstract — name the actual systems.");
  });

  it("insists on a reason when rejecting", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await reviewAssetAction(
      initialAdminEventState,
      form({ asset_id: doc.id, decision: "reject" }),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/Say what needs to change/);
    const [after] = await db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.id, doc.id));
    expect(after.reviewStatus).toBe("pending");
  });

  it("refuses to review a superseded version", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);
    // A re-run supersedes it.
    await runAgentAction(initialAdminEventState, form({ event_id: eventId, agent_type: AGENT }));

    const state = await reviewAssetAction(
      initialAdminEventState,
      form({ asset_id: doc.id, decision: "approve" }),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/newer version/);
  });
});

describe("editAndApproveAssetAction", () => {
  it("stores the edit as a new unattributed version and keeps the agent's draft", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await editAndApproveAssetAction(
      initialAdminEventState,
      form({
        asset_id: doc.id,
        title: "Research notes — edited",
        body: "What the agent wrote, tightened by a human.",
      }),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).toMatch(/version 2/);

    const versions = (await assetsFor(eventId)).filter((a) => a.type === doc.type);
    expect(versions).toHaveLength(2);

    const [original, edited] = versions;
    // The agent's original survives, still attributed to its run.
    expect(original.version).toBe(1);
    expect(original.agentRunId).not.toBeNull();
    expect(original.body).toContain("Shelter capacity data");

    // The human version is distinguishable precisely by having no run.
    expect(edited.version).toBe(2);
    expect(edited.agentRunId).toBeNull();
    expect(edited.reviewStatus).toBe("approved");
    expect(edited.body).toBe("What the agent wrote, tightened by a human.");

    expect(await auditActions(eventId)).toContain("generated_asset.edited");
  });

  it("refuses an edit that introduces credential material", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await editAndApproveAssetAction(
      initialAdminEventState,
      form({
        asset_id: doc.id,
        body: "Clone with ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 and go.",
      }),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/credential material/);
    // No new version was written.
    expect((await assetsFor(eventId)).filter((a) => a.type === doc.type)).toHaveLength(1);
  });

  it("refuses an empty document", async () => {
    const eventId = await createIntakenEvent();
    const doc = await runAndGetDoc(eventId);

    const state = await editAndApproveAssetAction(
      initialAdminEventState,
      form({ asset_id: doc.id, body: "   " }),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/can't be empty/);
  });
});

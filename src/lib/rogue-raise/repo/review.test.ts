/**
 * Integration tests for repo review against a REAL local Postgres, with the
 * local GitHub provider writing to a throwaway directory.
 */
import "dotenv/config";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GITHUB_DIR = mkdtempSync(path.join(tmpdir(), "rr-review-test-"));
process.env.RR_LOCAL_GITHUB_DIR = GITHUB_DIR;
delete process.env.RR_GITHUB_APP_ID;

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { registerAgentHandler, unregisterAgentHandler } from "../agents/registry";
import { db } from "../db";
import {
  agentRuns,
  auditLog,
  contextRepos,
  eventIntakes,
  events,
  generatedAssets,
  organizations,
  repoReviewComments,
  sponsorApplications,
} from "../db/schema";
import { resetGithubAdapter } from "../integrations/github";
import { provisionContextRepo } from "./provision";
import {
  addComment,
  approveRepo,
  listComments,
  loadRepoReview,
  requestRepoChanges,
} from "./review";

const createdOrgIds: string[] = [];

async function createProvisionedEvent(): Promise<string> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Review Repo Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail: `jamie-${suffix}@example.org`,
      pocPhone: "+15415551234",
      painPoints: "Shelter data is scattered.",
      goalsNeeds: "One view of capacity.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `review-repo-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: "intake_complete",
    })
    .returning({ id: events.id });

  await db.insert(eventIntakes).values({
    eventId: event.id,
    supplementaryInfo: "Nightly bed-count emails.",
    stakeholderTechStack: "Postgres.",
    stakeholderTechTags: ["postgres"],
    completedAt: new Date(),
  });

  await db.insert(generatedAssets).values(
    [
      { type: "research_doc" as const, body: "# Research\n\nFindings." },
      { type: "stakeholder_preferences" as const, body: "# Preferences\n\nPostgres." },
      { type: "example_prd" as const, body: "## PRD: Bed Board\n\nEasy." },
      { type: "setup_agent_instructions" as const, body: "# Setup\n\nCopy .env.example." },
    ].map((doc) => ({
      eventId: event.id,
      type: doc.type,
      title: doc.type,
      body: doc.body,
      version: 1,
      reviewStatus: "approved" as const,
    })),
  );

  const outcome = await provisionContextRepo(event.id, "wr-admin");
  if (!outcome.ok) throw new Error(`fixture failed to provision: ${outcome.reason}`);
  return event.id;
}

async function eventStatus(eventId: string): Promise<string> {
  const [row] = await db
    .select({ status: events.status })
    .from(events)
    .where(eq(events.id, eventId));
  return row.status;
}

beforeEach(() => {
  resetGithubAdapter();
});

afterAll(async () => {
  unregisterAgentHandler("context_research_repo");
  if (createdOrgIds.length) {
    const eventIds = (
      await db
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.orgId, createdOrgIds))
    ).map((e) => e.id);
    if (eventIds.length) {
      await db
        .delete(repoReviewComments)
        .where(inArray(repoReviewComments.eventId, eventIds));
      await db.delete(contextRepos).where(inArray(contextRepos.eventId, eventIds));
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
  rmSync(GITHUB_DIR, { recursive: true, force: true });
});

describe("loadRepoReview", () => {
  it("shows every pushed file and links the ones a draft produced", async () => {
    const eventId = await createProvisionedEvent();
    const view = await loadRepoReview(eventId);

    expect(view).not.toBeNull();
    const paths = view!.files.map((f) => f.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("research/README.md");
    expect(paths).toContain("tools/README.md");

    // Files that came from a reviewable draft point back at it…
    const research = view!.files.find((f) => f.path === "research/README.md")!;
    expect(research.sourceAssetType).toBe("research_doc");
    expect(research.sourceAssetId).not.toBeNull();
    expect(research.content).toContain("Findings.");

    // …and generated wrappers don't pretend to be drafts.
    const tools = view!.files.find((f) => f.path === "tools/README.md")!;
    expect(tools.sourceAssetId).toBeNull();

    expect(view!.isPublic).toBe(false);
    expect(view!.repoUrl).not.toBeNull();
  });

  it("threads comments under the file they're about", async () => {
    const eventId = await createProvisionedEvent();
    await addComment({ eventId, filePath: "README.md", body: "Name the county." });
    await addComment({ eventId, filePath: "README.md", body: "And the dates." });
    await addComment({ eventId, filePath: null, body: "Overall this reads well." });

    const view = await loadRepoReview(eventId);
    const readme = view!.files.find((f) => f.path === "README.md")!;
    expect(readme.comments.map((c) => c.body)).toEqual([
      "Name the county.",
      "And the dates.",
    ]);
    expect(view!.generalComments.map((c) => c.body)).toEqual(["Overall this reads well."]);
  });
});

describe("approveRepo", () => {
  it("publishes the repo and moves the event to repo_approved", async () => {
    const eventId = await createProvisionedEvent();
    expect(await eventStatus(eventId)).toBe("repo_review");

    const outcome = await approveRepo(eventId, "wr-admin");

    expect(outcome.ok).toBe(true);
    expect(await eventStatus(eventId)).toBe("repo_approved");
    const [repo] = await db
      .select()
      .from(contextRepos)
      .where(eq(contextRepos.eventId, eventId));
    expect(repo.isPublic).toBe(true);

    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.eventId, eventId))
        .orderBy(auditLog.createdAt)
    ).map((r) => r.action);
    expect(actions).toContain("event.repo_approved");
  });

  it("refuses from the wrong phase rather than publishing twice", async () => {
    const eventId = await createProvisionedEvent();
    await approveRepo(eventId, "wr-admin");

    const second = await approveRepo(eventId, "wr-admin");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/repo_approved/);
  });
});

describe("requestRepoChanges", () => {
  it("records the feedback and re-runs the agent with every comment so far", async () => {
    const eventId = await createProvisionedEvent();

    // A prior run to re-run from, and a handler that reports what it was told.
    let seenInstructions: string | undefined;
    registerAgentHandler("context_research_repo", async (ctx) => {
      seenInstructions = ctx.additionalInstructions;
      return { assets: [{ type: "research_doc", body: "Revised." }] };
    });
    const { runAgent } = await import("../agents/execute");
    await runAgent({ eventId, type: "context_research_repo" });

    await addComment({ eventId, filePath: "README.md", body: "Name the county." });
    const outcome = await requestRepoChanges({
      eventId,
      feedback: "The research is too general.",
    });

    expect(outcome.ok).toBe(true);
    // Both the earlier file comment and the new feedback reach the agent.
    expect(seenInstructions).toContain("README.md: Name the county.");
    expect(seenInstructions).toContain("The research is too general.");

    const comments = await listComments(eventId);
    expect(comments.some((c) => c.decision === "request_changes")).toBe(true);
  });

  it("records feedback even when there is no earlier run to re-run", async () => {
    const eventId = await createProvisionedEvent();
    const outcome = await requestRepoChanges({ eventId, feedback: "Needs more depth." });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.notice).toMatch(/no earlier research run/);
    expect(await listComments(eventId)).toHaveLength(1);
  });
});

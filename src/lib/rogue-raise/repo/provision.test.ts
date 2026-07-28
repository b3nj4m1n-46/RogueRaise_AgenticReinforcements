/**
 * Integration tests for context-repo provisioning against a REAL local Postgres.
 * The GitHub seam uses the LOCAL provider pointed at a throwaway directory, so
 * files genuinely land on disk and the assertions are about real output.
 */
import "dotenv/config";

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GITHUB_DIR = mkdtempSync(path.join(tmpdir(), "rr-github-test-"));
process.env.RR_LOCAL_GITHUB_DIR = GITHUB_DIR;
delete process.env.RR_GITHUB_APP_ID;

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "../db";
import {
  auditLog,
  contextRepos,
  eventIntakes,
  events,
  generatedAssets,
  organizations,
  sponsorApplications,
} from "../db/schema";
import { resetGithubAdapter } from "../integrations/github";
import { describeProvisioningBlockers, provisionContextRepo } from "./provision";
import { loadContextRepo } from "./queries";

const createdOrgIds: string[] = [];

const DOCUMENTS = [
  { type: "research_doc" as const, body: "# Research\n\nBed counts are emailed nightly." },
  { type: "stakeholder_preferences" as const, body: "# Preferences\n\nStay in Postgres." },
  {
    type: "example_prd" as const,
    body: "Pick one.\n\n## PRD: Bed Board\n\nEasy.\n\n## PRD: Intake Triage\n\nHarder.",
  },
  {
    type: "setup_agent_instructions" as const,
    body: "# Setup\n\nCopy .env.example to .env and ask an organizer for the key.",
  },
];

async function createEventWithDocuments(
  options: { reviewStatus?: "pending" | "approved"; status?: string } = {},
): Promise<string> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Repo Test Org ${suffix}` })
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
      slug: `repo-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "intake_complete") as "intake_complete",
    })
    .returning({ id: events.id });

  await db.insert(eventIntakes).values({
    eventId: event.id,
    supplementaryInfo: "Five years of nightly bed-count emails.",
    stakeholderTechStack: "Postgres 14 and a Django admin.",
    stakeholderTechTags: ["postgres"],
    completedAt: new Date(),
  });

  await db.insert(generatedAssets).values(
    DOCUMENTS.map((doc) => ({
      eventId: event.id,
      type: doc.type,
      title: doc.type,
      body: doc.body,
      version: 1,
      reviewStatus: (options.reviewStatus ?? "approved") as "approved",
    })),
  );

  return event.id;
}

async function eventStatus(eventId: string): Promise<string> {
  const [row] = await db
    .select({ status: events.status })
    .from(events)
    .where(eq(events.id, eventId));
  return row.status;
}

/** Every file the local provider wrote for this repo. */
function writtenFiles(repoUrl: string): string[] {
  const dir = repoUrl.replace("file://", "");
  if (!existsSync(dir)) return [];
  const walk = (base: string, prefix = ""): string[] => {
    return readdirSync(base).flatMap((entry: string) => {
      const full = path.join(base, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      return statSync(full).isDirectory() ? walk(full, rel) : [rel];
    });
  };
  return walk(dir);
}

beforeEach(() => {
  resetGithubAdapter();
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
      await db.delete(contextRepos).where(inArray(contextRepos.eventId, eventIds));
      await db.delete(generatedAssets).where(inArray(generatedAssets.eventId, eventIds));
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

describe("provisionContextRepo — the review gate holds", () => {
  it("refuses while a document is still awaiting review, and names it", async () => {
    const eventId = await createEventWithDocuments({ reviewStatus: "pending" });

    const blockers = await describeProvisioningBlockers(eventId);
    expect(blockers).toHaveLength(4);
    expect(blockers[0]).toMatch(/needs approving/);

    const outcome = await provisionContextRepo(eventId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Research notes is pending/);

    // Nothing was created and the event never moved.
    expect(await loadContextRepo(eventId)).toBeNull();
    expect(await eventStatus(eventId)).toBe("intake_complete");
  });

  it("names a document that hasn't been drafted at all", async () => {
    const eventId = await createEventWithDocuments();
    await db
      .delete(generatedAssets)
      .where(eq(generatedAssets.eventId, eventId));

    const blockers = await describeProvisioningBlockers(eventId);
    expect(blockers.every((b) => b.includes("hasn't been drafted"))).toBe(true);
  });

  it("refuses outside the right phase", async () => {
    const eventId = await createEventWithDocuments({ status: "registration_open" });
    const outcome = await provisionContextRepo(eventId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/this event is "registration_open"/);
  });
});

describe("provisionContextRepo — happy path", () => {
  it("writes the whole PRD tree, records the repo, and moves the event", async () => {
    const eventId = await createEventWithDocuments();

    const outcome = await provisionContextRepo(eventId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.updated).toBe(false);
    expect(outcome.fileCount).toBeGreaterThanOrEqual(8);

    // The files really landed.
    const files = writtenFiles(outcome.repoUrl);
    const paths = files.map((f) => f.replace(/^rogue-raise\/context\//, ""));
    expect(paths).toContain("README.md");
    expect(paths).toContain("stakeholder-preferences.md");
    expect(paths).toContain("setup-agent-instructions.md");
    expect(paths).toContain(".gitignore");
    expect(paths.some((p) => p.startsWith("research/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("context/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("tools/"))).toBe(true);
    expect(paths.filter((p) => p.startsWith("prds/")).length).toBeGreaterThanOrEqual(2);

    // The approved text is what got written.
    const readmePath = path.join(
      outcome.repoUrl.replace("file://", ""),
      "rogue-raise/context/research/README.md",
    );
    expect(readFileSync(readmePath, "utf8")).toContain("Bed counts are emailed nightly.");

    const repo = await loadContextRepo(eventId);
    expect(repo).not.toBeNull();
    expect(repo!.isPublic).toBe(false); // private during review
    expect(repo!.openPrUrl).toBe(outcome.pullRequestUrl);

    expect(await eventStatus(eventId)).toBe("repo_review");

    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.eventId, eventId))
        .orderBy(auditLog.createdAt)
    ).map((r) => r.action);
    expect(actions).toEqual(["event.repo_generating", "event.repo_review"]);
  });

  it("updates the existing repo instead of creating a second one", async () => {
    const eventId = await createEventWithDocuments();
    const first = await provisionContextRepo(eventId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await provisionContextRepo(eventId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.updated).toBe(true);
    expect(second.repoUrl).toBe(first.repoUrl);

    const repos = await db
      .select()
      .from(contextRepos)
      .where(eq(contextRepos.eventId, eventId));
    expect(repos).toHaveLength(1);
  });
});

describe("provisionContextRepo — secrets", () => {
  it("aborts before pushing anything when a document carries a credential", async () => {
    const eventId = await createEventWithDocuments();
    await db
      .update(generatedAssets)
      .set({ body: "Clone with ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 first." })
      .where(eq(generatedAssets.eventId, eventId));

    const outcome = await provisionContextRepo(eventId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/credential material/);
    expect(outcome.reason).toMatch(/Nothing was pushed/);
    // The refusal names the file but never the secret.
    expect(outcome.reason).not.toContain("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");

    expect(await loadContextRepo(eventId)).toBeNull();
    expect(await eventStatus(eventId)).toBe("intake_complete");
  });
});

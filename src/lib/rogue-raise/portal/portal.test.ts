/**
 * Phase 4 — the handoff portal, its access scoping, and the categorizer's
 * write path — against a REAL local Postgres. Email, GitHub, and the model are
 * mocked; everything else is real.
 */
import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, statsMock, generateMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  statsMock: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("../integrations/github", () => ({
  fetchRepoStats: statsMock,
}));
vi.mock("../integrations/ai-gateway", () => ({
  getAiAdapter: () => ({ generate: generateMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { runAgent } from "../agents/execute";
import { registerAgentHandlers } from "../agents/handlers";
import { db } from "../db";
import {
  agentRuns,
  auditLog,
  awardCategories,
  criteria,
  events,
  generatedAssets,
  judgeScores,
  judges,
  magicLinkTokens,
  organizations,
  participants,
  sponsorApplications,
  stakeholders,
  submissions,
  teamMemberships,
  teams,
} from "../db/schema";
import { generateMagicToken } from "../sponsors/magic-link";
import { redeemStakeholderToken } from "./access";
import { markStewardship } from "./actions";
import { closePortalFor, isPortalOpen, openPortal } from "./invite";
import { loadPortal } from "./queries";

registerAgentHandlers();

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  stakeholderIds: string[];
  submissionIds: string[];
  criterionIds: string[];
  judgeId: string;
}

async function createFixture(
  options: { status?: string } = {},
): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Portal Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail: `poc-${suffix}@example.org`,
      pocPhone: "+15415551234",
      painPoints: "Shelter capacity data lives in spreadsheets.",
      goalsNeeds: "One view of beds tonight.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `portal-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "completed") as "completed",
    })
    .returning({ id: events.id });

  const stakeholderRows = await db
    .insert(stakeholders)
    .values([
      { eventId: event.id, name: "Dana Steward", email: `dana-${suffix}@example.org` },
      { eventId: event.id, name: "Ray Director", email: `ray-${suffix}@example.org` },
    ])
    .returning({ id: stakeholders.id });

  const criterionRows = await db
    .insert(criteria)
    .values([
      { eventId: event.id, label: "Impact", weight: null, sortOrder: 0 },
      { eventId: event.id, label: "Craft", weight: null, sortOrder: 1 },
    ])
    .returning({ id: criteria.id });

  const [judge] = await db
    .insert(judges)
    .values({ eventId: event.id, name: "Ada Judge", email: `ada-${suffix}@example.org` })
    .returning({ id: judges.id });

  // Two teams, each with one member, each with a submission.
  const submissionIds: string[] = [];
  for (const [index, name] of ["Beds Tonight", "Warm Handoff"].entries()) {
    const [participant] = await db
      .insert(participants)
      .values({
        eventId: event.id,
        firstName: `Builder${index}`,
        lastName: "Person",
        email: `builder${index}-${suffix}@example.org`,
        githubUsername: `builder${index}`,
      })
      .returning({ id: participants.id });
    const [team] = await db
      .insert(teams)
      .values({ eventId: event.id, name })
      .returning({ id: teams.id });
    await db
      .insert(teamMemberships)
      .values({ teamId: team.id, participantId: participant.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        eventId: event.id,
        teamId: team.id,
        teamName: name,
        projectSummary: `What ${name} built over the weekend.`,
        repoUrl: `https://github.com/wr/${name.toLowerCase().replace(/\s+/g, "-")}`,
        submittedAt: new Date(),
      })
      .returning({ id: submissions.id });
    submissionIds.push(submission.id);
  }

  return {
    eventId: event.id,
    stakeholderIds: stakeholderRows.map((s) => s.id),
    submissionIds,
    criterionIds: criterionRows.map((c) => c.id),
    judgeId: judge.id,
  };
}

/** The raw token most recently minted for a stakeholder isn't recoverable, so
 * tests that need one mint their own. */
async function mintStakeholderToken(
  eventId: string,
  stakeholderId: string,
): Promise<string> {
  const { raw, hash } = generateMagicToken();
  await db.insert(magicLinkTokens).values({
    eventId,
    role: "stakeholder",
    subjectId: stakeholderId,
    email: "test@example.org",
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return raw;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ id: "msg" });
  statsMock
    .mockReset()
    .mockResolvedValue({ linesOfCode: 1000, languages: { TypeScript: 100 } });
  generateMock.mockReset();
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
      const submissionIds = (
        await db
          .select({ id: submissions.id })
          .from(submissions)
          .where(inArray(submissions.eventId, eventIds))
      ).map((s) => s.id);
      if (submissionIds.length) {
        await db
          .delete(judgeScores)
          .where(inArray(judgeScores.submissionId, submissionIds));
      }
      await db
        .delete(awardCategories)
        .where(inArray(awardCategories.eventId, eventIds));
      await db.delete(submissions).where(inArray(submissions.eventId, eventIds));
      const teamIds = (
        await db
          .select({ id: teams.id })
          .from(teams)
          .where(inArray(teams.eventId, eventIds))
      ).map((t) => t.id);
      if (teamIds.length) {
        await db
          .delete(teamMemberships)
          .where(inArray(teamMemberships.teamId, teamIds));
        await db.delete(teams).where(inArray(teams.id, teamIds));
      }
      await db.delete(participants).where(inArray(participants.eventId, eventIds));
      await db.delete(judges).where(inArray(judges.eventId, eventIds));
      await db.delete(criteria).where(inArray(criteria.eventId, eventIds));
      await db.delete(stakeholders).where(inArray(stakeholders.eventId, eventIds));
      await db
        .delete(generatedAssets)
        .where(inArray(generatedAssets.eventId, eventIds));
      await db.delete(agentRuns).where(inArray(agentRuns.eventId, eventIds));
      await db
        .delete(magicLinkTokens)
        .where(inArray(magicLinkTokens.eventId, eventIds));
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("isPortalOpen", () => {
  it("opens only once the event is finished", () => {
    expect(isPortalOpen("completed")).toBe(true);
    expect(isPortalOpen("archived")).toBe(true);
    for (const status of ["live", "judging", "registration_open", "draft"]) {
      expect(isPortalOpen(status)).toBe(false);
    }
  });
});

describe("openPortal", () => {
  it("grants access, mints a link, and emails each stakeholder once", async () => {
    const fixture = await createFixture();
    expect(await openPortal(fixture.eventId, "wr-admin")).toMatchObject({ ok: true, sent: 2 });
    expect(sendMock).toHaveBeenCalledTimes(2);

    const rows = await db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.eventId, fixture.eventId));
    expect(rows.every((s) => s.canAccessPortal)).toBe(true);

    // Idempotent: already-granted stakeholders are skipped.
    expect(await openPortal(fixture.eventId, "wr-admin")).toMatchObject({
      ok: true,
      sent: 0,
      skipped: 2,
    });
    expect(await openPortal(fixture.eventId, "wr-admin", { resend: true })).toMatchObject({
      ok: true,
      sent: 2,
    });
  });

  it("refuses before the event is completed, so scores can't be read mid-judging", async () => {
    const fixture = await createFixture({ status: "judging" });
    const outcome = await openPortal(fixture.eventId, "wr-admin");
    expect(outcome).toMatchObject({ ok: false });
    expect(sendMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.eventId, fixture.eventId));
    expect(rows.every((s) => !s.canAccessPortal)).toBe(true);
  });

  it("never emits a raw token into the audit log", async () => {
    const fixture = await createFixture();
    await openPortal(fixture.eventId, "wr-admin");
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventId, fixture.eventId));
    const serialized = JSON.stringify(rows);
    expect(serialized).toContain("portal.opened");
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
});

describe("redeemStakeholderToken", () => {
  it("refuses a valid token while the flag is off", async () => {
    const fixture = await createFixture();
    const raw = await mintStakeholderToken(fixture.eventId, fixture.stakeholderIds[0]);

    // Being named on an event is not the same as being let in.
    const before = await redeemStakeholderToken({
      rawToken: raw,
      eventId: fixture.eventId,
    });
    expect(before).toMatchObject({ ok: false, reason: "not_open" });

    await openPortal(fixture.eventId, "wr-admin");
    const after = await redeemStakeholderToken({
      rawToken: raw,
      eventId: fixture.eventId,
    });
    expect(after.ok).toBe(true);
  });

  it("refuses a token from another event", async () => {
    const [a, b] = await Promise.all([createFixture(), createFixture()]);
    await Promise.all([openPortal(a.eventId, "wr-admin"), openPortal(b.eventId, "wr-admin")]);
    const raw = await mintStakeholderToken(b.eventId, b.stakeholderIds[0]);

    const cross = await redeemStakeholderToken({
      rawToken: raw,
      eventId: a.eventId,
    });
    expect(cross.ok).toBe(false);
  });

  it("stops working after the portal is closed for that stakeholder", async () => {
    const fixture = await createFixture();
    await openPortal(fixture.eventId, "wr-admin");
    const raw = await mintStakeholderToken(fixture.eventId, fixture.stakeholderIds[0]);
    expect(
      (await redeemStakeholderToken({ rawToken: raw, eventId: fixture.eventId })).ok,
    ).toBe(true);

    await closePortalFor(fixture.eventId, fixture.stakeholderIds[0], "wr-admin");
    const after = await redeemStakeholderToken({
      rawToken: raw,
      eventId: fixture.eventId,
    });
    // Revoked, not merely flagged — the token itself is dead.
    expect(after).toMatchObject({ ok: false, reason: "revoked" });
  });
});

describe("loadPortal", () => {
  it("shows contact details, evaluations, and a download link per project", async () => {
    const fixture = await createFixture();
    await db.insert(judgeScores).values({
      submissionId: fixture.submissionIds[0],
      judgeId: fixture.judgeId,
      scores: { [fixture.criterionIds[0]]: 5, [fixture.criterionIds[1]]: 3 },
      notes: "Ship the export first.",
      finalScore: "4.000",
      isDraft: false,
      submittedAt: new Date(),
    });

    const portal = await loadPortal(fixture.eventId);
    const first = portal.submissions.find(
      (s) => s.id === fixture.submissionIds[0],
    )!;
    expect(first.members[0].email).toContain("builder0-");
    expect(first.members[0].githubUsername).toBe("builder0");
    expect(first.downloadUrl).toContain("/archive/refs/heads/HEAD.zip");
    expect(first.evaluations).toHaveLength(1);
    expect(first.evaluations[0].notes).toBe("Ship the export first.");
    expect(first.averageScore).toBe(4);
  });

  it("excludes a judge's draft card from the evaluations a sponsor reads", async () => {
    const fixture = await createFixture();
    await db.insert(judgeScores).values({
      submissionId: fixture.submissionIds[0],
      judgeId: fixture.judgeId,
      scores: { [fixture.criterionIds[0]]: 1 },
      isDraft: true,
    });

    const portal = await loadPortal(fixture.eventId);
    const first = portal.submissions.find(
      (s) => s.id === fixture.submissionIds[0],
    )!;
    expect(first.evaluations).toEqual([]);
    expect(first.averageScore).toBeNull();
  });

  it("shows only ANNOUNCED awards", async () => {
    const fixture = await createFixture();
    await db.insert(awardCategories).values([
      {
        eventId: fixture.eventId,
        label: "Announced Award",
        winningSubmissionId: fixture.submissionIds[0],
        announcedAt: new Date(),
      },
      {
        eventId: fixture.eventId,
        label: "Secret Award",
        winningSubmissionId: fixture.submissionIds[1],
      },
    ]);

    const portal = await loadPortal(fixture.eventId);
    expect(portal.awards.map((a) => a.label)).toEqual(["Announced Award"]);
    // The undecided one must not leak onto the project card either.
    const second = portal.submissions.find(
      (s) => s.id === fixture.submissionIds[1],
    )!;
    expect(second.awards).toEqual([]);
  });

  it("hides an unapproved summary document", async () => {
    const fixture = await createFixture();
    await db.insert(generatedAssets).values({
      eventId: fixture.eventId,
      type: "submission_summary",
      body: "Draft prose the sponsor must not see yet.",
      version: 1,
      reviewStatus: "pending",
    });
    expect((await loadPortal(fixture.eventId)).summaryDocument).toBeNull();

    await db
      .update(generatedAssets)
      .set({ reviewStatus: "approved" })
      .where(eq(generatedAssets.eventId, fixture.eventId));
    expect((await loadPortal(fixture.eventId)).summaryDocument).toContain("Draft prose");
  });

  it("reports lines as null rather than zero when nothing was counted", async () => {
    const fixture = await createFixture();
    const portal = await loadPortal(fixture.eventId);
    expect(portal.stats.totalLinesOfCode).toBeNull();
    expect(portal.stats.countedRepos).toBe(0);
  });
});

describe("markStewardship", () => {
  async function openedFixture() {
    const fixture = await createFixture();
    await openPortal(fixture.eventId, "wr-admin");
    const token = await mintStakeholderToken(
      fixture.eventId,
      fixture.stakeholderIds[0],
    );
    return { fixture, token };
  }

  it("records the choice and names who made it", async () => {
    const { fixture, token } = await openedFixture();
    const result = await markStewardship({
      eventId: fixture.eventId,
      token,
      submissionId: fixture.submissionIds[0],
      stewardship: "adopted",
    });
    expect(result).toMatchObject({ ok: true, stewardship: "adopted" });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, fixture.submissionIds[0]));
    expect(row.stewardship).toBe("adopted");

    // Scoped to THIS event: an action-only filter picks up rows left by other
    // fixtures (and by manual use of the dev database), which is how a test
    // ends up asserting against somebody else's data.
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, fixture.eventId),
          eq(auditLog.action, "submission.stewardship_marked"),
        ),
      );
    expect(audit.actor).toBe(`stakeholder:${fixture.stakeholderIds[0]}`);
    expect(audit.fromValue).toBe("unmarked");
    expect(audit.toValue).toBe("adopted");
  });

  it("is reversible — a commitment can be taken back", async () => {
    const { fixture, token } = await openedFixture();
    const mark = (stewardship: string) =>
      markStewardship({
        eventId: fixture.eventId,
        token,
        submissionId: fixture.submissionIds[0],
        stewardship,
      });
    await mark("adopted");
    expect(await mark("archived")).toMatchObject({ ok: true });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, fixture.submissionIds[0]));
    expect(row.stewardship).toBe("archived");
  });

  it("rejects a value outside the vocabulary", async () => {
    const { fixture, token } = await openedFixture();
    const result = await markStewardship({
      eventId: fixture.eventId,
      token,
      submissionId: fixture.submissionIds[0],
      stewardship: "sold",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses to mark another event's project", async () => {
    const a = await openedFixture();
    const b = await openedFixture();
    const result = await markStewardship({
      eventId: a.fixture.eventId,
      token: a.token,
      submissionId: b.fixture.submissionIds[0],
      stewardship: "adopted",
    });
    expect(result).toMatchObject({ ok: false });

    const [untouched] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, b.fixture.submissionIds[0]));
    expect(untouched.stewardship).toBe("unmarked");
  });

  it("refuses without a valid token", async () => {
    const fixture = await createFixture();
    await openPortal(fixture.eventId, "wr-admin");
    const result = await markStewardship({
      eventId: fixture.eventId,
      token: "not-a-real-token",
      submissionId: fixture.submissionIds[0],
      stewardship: "adopted",
    });
    expect(result.ok).toBe(false);
  });
});

describe("submission categorizer agent", () => {
  function reply(fixture: Fixture): string {
    return [
      "## OVERVIEW",
      "Both teams built for the front desk; nobody touched intake.",
      "",
      `## SUBMISSION: ${fixture.submissionIds[0]}`,
      "CATEGORY: Data dashboard",
      "Shows free beds tonight.",
      "",
      `## SUBMISSION: ${fixture.submissionIds[1]}`,
      "CATEGORY: Referral tracker",
      "Carries case notes between services.",
    ].join("\n");
  }

  it("writes line counts and categories onto the submissions", async () => {
    const fixture = await createFixture();
    generateMock.mockResolvedValue({
      text: reply(fixture),
      usage: { totalTokens: 900 },
    });

    const outcome = await runAgent({
      eventId: fixture.eventId,
      type: "submission_categorizer",
    });
    expect(outcome.ok).toBe(true);

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    expect(rows.every((r) => r.linesOfCode === 1000)).toBe(true);
    expect(rows.map((r) => r.submissionCategory).sort()).toEqual([
      "Data dashboard",
      "Referral tracker",
    ]);
  });

  it("keeps line counts even when the model returns no usable blocks", async () => {
    const fixture = await createFixture();
    generateMock.mockResolvedValue({
      text: "They all built software, broadly speaking.",
      usage: { totalTokens: 20 },
    });

    expect(
      (await runAgent({ eventId: fixture.eventId, type: "submission_categorizer" }))
        .ok,
    ).toBe(true);

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    // The count is a fact about the repo; the categorization isn't, so one
    // failing must not discard the other.
    expect(rows.every((r) => r.linesOfCode === 1000)).toBe(true);
    expect(rows.every((r) => r.submissionCategory === null)).toBe(true);
  });

  it("stores null, not zero, for a repo GitHub wouldn't count", async () => {
    const fixture = await createFixture();
    statsMock.mockResolvedValue({ linesOfCode: null, languages: null });
    generateMock.mockResolvedValue({
      text: reply(fixture),
      usage: { totalTokens: 100 },
    });

    await runAgent({ eventId: fixture.eventId, type: "submission_categorizer" });
    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    expect(rows.every((r) => r.linesOfCode === null)).toBe(true);

    const portal = await loadPortal(fixture.eventId);
    expect(portal.stats.totalLinesOfCode).toBeNull();
  });

  it("ignores a hallucinated submission id instead of writing it somewhere", async () => {
    const fixture = await createFixture();
    generateMock.mockResolvedValue({
      text: [
        "## OVERVIEW",
        "Fine.",
        "",
        "## SUBMISSION: 99999999-9999-9999-9999-999999999999",
        "CATEGORY: Invented",
        "Not a real project.",
      ].join("\n"),
      usage: { totalTokens: 50 },
    });

    await runAgent({ eventId: fixture.eventId, type: "submission_categorizer" });
    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    expect(rows.every((r) => r.submissionCategory === null)).toBe(true);
  });

  it("produces a reviewable summary that starts pending", async () => {
    const fixture = await createFixture();
    generateMock.mockResolvedValue({
      text: reply(fixture),
      usage: { totalTokens: 900 },
    });

    await runAgent({ eventId: fixture.eventId, type: "submission_categorizer" });
    const [asset] = await db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.eventId, fixture.eventId));
    expect(asset.type).toBe("submission_summary");
    expect(asset.reviewStatus).toBe("pending");
    expect(asset.body).toContain("nobody touched intake");
    // The caveat travels with the number.
    expect(asset.body).toContain("describe scale, not effort");
  });

  it("never writes '0 lines of code' when nothing could be counted", async () => {
    const fixture = await createFixture();
    statsMock.mockResolvedValue({ linesOfCode: null, languages: null });
    generateMock.mockResolvedValue({
      text: reply(fixture),
      usage: { totalTokens: 100 },
    });

    await runAgent({ eventId: fixture.eventId, type: "submission_categorizer" });
    const [asset] = await db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.eventId, fixture.eventId));
    // A sponsor reading "0 lines of code" would conclude the teams built
    // nothing, which is the opposite of what a failed count means.
    expect(asset.body).not.toContain("0 lines of code");
    expect(asset.body).toContain("couldn't count the lines of code");
  });

  it("fails cleanly when there is nothing to categorize", async () => {
    const fixture = await createFixture();
    await db.delete(submissions).where(eq(submissions.eventId, fixture.eventId));

    const outcome = await runAgent({
      eventId: fixture.eventId,
      type: "submission_categorizer",
    });
    expect(outcome.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

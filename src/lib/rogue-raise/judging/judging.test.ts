/**
 * Phase 3 end to end — submission, scoring, tabulation, awards — against a REAL
 * local Postgres. Only email and the GitHub repo check are mocked.
 */
import "dotenv/config";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, checkRepoMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  checkRepoMock: vi.fn(),
}));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("../integrations/github", () => ({
  checkGithubRepo: checkRepoMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import { db } from "../db";
import {
  auditLog,
  awardCategories,
  criteria,
  events,
  judgeScores,
  judges,
  magicLinkTokens,
  organizations,
  participants,
  sponsorApplications,
  submissions,
  teamMemberships,
  teams,
} from "../db/schema";
import { generateMagicToken } from "../sponsors/magic-link";
import { initialSubmissionFormState } from "../submissions/form-state";
import { submitProject } from "../submissions/actions";
import { sendSubmissionInvites } from "../submissions/invite";
import { closeJudging, openJudging, saveScorecard } from "./actions";
import {
  announceAward,
  createAwardCategory,
  setAwardWinner,
} from "./award-actions";
import { initialScorecardState } from "./form-state";
import { sendScoringLinks } from "./invite";
import { loadJudgingPacket, loadResults } from "./queries";

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  criterionIds: string[];
  judgeIds: string[];
  participantIds: string[];
  participantEmails: string[];
  participantNames: string[];
  /** Raw participant tokens, index-aligned with `participantIds`. */
  participantTokens: string[];
  /** Raw judge tokens, index-aligned with `judgeIds`. */
  judgeTokens: string[];
}

const HOUR = 60 * 60 * 1000;

async function mintToken(
  eventId: string,
  role: "participant" | "judge",
  subjectId: string,
  email: string,
): Promise<string> {
  const { raw, hash } = generateMagicToken();
  await db.insert(magicLinkTokens).values({
    eventId,
    role,
    subjectId,
    email,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
  return raw;
}

/** A live event with two criteria, two judges, and three registered builders. */
async function createFixture(
  options: { status?: string; weights?: (string | null)[] } = {},
): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Judging Org ${suffix}` })
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
      slug: `judging-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "live") as "live",
      confirmedFridayKickoffAt: new Date("2026-08-15T00:00:00.000Z"),
    })
    .returning({ id: events.id });

  const weights = options.weights ?? [null, null];
  const criterionRows = await db
    .insert(criteria)
    .values([
      { eventId: event.id, label: "Impact", weight: weights[0], sortOrder: 0 },
      { eventId: event.id, label: "Craft", weight: weights[1], sortOrder: 1 },
    ])
    .returning({ id: criteria.id });

  const judgeRows = await db
    .insert(judges)
    .values([
      { eventId: event.id, name: "Ada Judge", email: `ada-${suffix}@example.org` },
      { eventId: event.id, name: "Grace Judge", email: `grace-${suffix}@example.org` },
    ])
    .returning({ id: judges.id, email: judges.email });

  const participantRows = await db
    .insert(participants)
    .values([
      {
        eventId: event.id,
        firstName: "Bea",
        lastName: "Builder",
        email: `bea-${suffix}@example.org`,
        githubUsername: "bea",
      },
      {
        eventId: event.id,
        firstName: "Cal",
        lastName: "Coder",
        email: `cal-${suffix}@example.org`,
        githubUsername: "cal",
      },
      {
        eventId: event.id,
        firstName: "Dee",
        lastName: "Dev",
        email: `dee-${suffix}@example.org`,
        githubUsername: "dee",
      },
    ])
    .returning({ id: participants.id, email: participants.email });

  return {
    eventId: event.id,
    criterionIds: criterionRows.map((c) => c.id),
    judgeIds: judgeRows.map((j) => j.id),
    participantIds: participantRows.map((p) => p.id),
    participantEmails: participantRows.map((p) => p.email),
    participantNames: ["Bea Builder", "Cal Coder", "Dee Dev"],
    participantTokens: await Promise.all(
      participantRows.map((p) =>
        mintToken(event.id, "participant", p.id, p.email),
      ),
    ),
    judgeTokens: await Promise.all(
      judgeRows.map((j) => mintToken(event.id, "judge", j.id, j.email)),
    ),
  };
}

function submissionForm(
  fixture: Fixture,
  tokenIndex: number,
  overrides: Record<string, string> = {},
): FormData {
  const data = new FormData();
  data.set("event_id", fixture.eventId);
  data.set("token", fixture.participantTokens[tokenIndex]);
  data.set("team_name", "The Barn Raisers");
  data.set(
    "project_summary",
    "A single view of shelter bed availability, updated by phone.",
  );
  data.set("repo_url", "https://github.com/wr/beds-tonight");
  data.set("pitch_materials_url", "");
  // The real form pre-fills the submitter, so the fixture does too.
  data.set(
    "members_json",
    JSON.stringify([
      {
        name: fixture.participantNames[tokenIndex],
        email: fixture.participantEmails[tokenIndex],
      },
    ]),
  );
  for (const [k, v] of Object.entries(overrides)) data.set(k, v);
  return data;
}

/** The action redirects on success, which throws NEXT_REDIRECT. */
async function submit(form: FormData) {
  try {
    return await submitProject(initialSubmissionFormState, form);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) {
      return { redirected: true } as const;
    }
    throw err;
  }
}

function scoreForm(
  fixture: Fixture,
  judgeIndex: number,
  submissionId: string,
  scores: (number | null)[],
  intent: "draft" | "final",
): FormData {
  const data = new FormData();
  data.set("event_id", fixture.eventId);
  data.set("token", fixture.judgeTokens[judgeIndex]);
  data.set("submission_id", submissionId);
  data.set("intent", intent);
  fixture.criterionIds.forEach((id, i) => {
    if (scores[i] !== null && scores[i] !== undefined) {
      data.set(`score_${id}`, String(scores[i]));
    }
  });
  return data;
}

async function submissionIdFor(eventId: string): Promise<string> {
  const [row] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.eventId, eventId))
    .limit(1);
  return row.id;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ id: "msg" });
  checkRepoMock.mockReset().mockResolvedValue("unknown");
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

describe("submitProject", () => {
  it("records a submission, a team, and the submitter's membership", async () => {
    const fixture = await createFixture();
    const result = await submit(submissionForm(fixture, 0));
    expect(result).toEqual({ redirected: true });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    expect(row.teamName).toBe("The Barn Raisers");
    expect(row.submittedAt).toBeInstanceOf(Date);

    const memberships = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, row.teamId));
    expect(memberships.map((m) => m.participantId)).toEqual([
      fixture.participantIds[0],
    ]);
  });

  it("links teammates who are registered, by email", async () => {
    const fixture = await createFixture();
    const [, cal] = await db
      .select({ email: participants.email })
      .from(participants)
      .where(eq(participants.eventId, fixture.eventId))
      .orderBy(participants.createdAt);

    await submit(
      submissionForm(fixture, 0, {
        members_json: JSON.stringify([
          {
            name: fixture.participantNames[0],
            email: fixture.participantEmails[0],
          },
          { name: "Cal Coder", email: cal.email.toUpperCase() },
        ]),
      }),
    );

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    const memberships = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, row.teamId));
    // Case-insensitive match, and the submitter is still on their own team.
    expect(memberships).toHaveLength(2);
  });

  it("refuses a second submission from someone already on a team", async () => {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));
    const again = await submit(
      submissionForm(fixture, 0, { team_name: "Second Try" }),
    );
    expect(again).toMatchObject({ ok: false });
    expect((again as { formError?: string }).formError).toContain(
      "already on a team",
    );
  });

  it("refuses once the window has closed, even with a valid token", async () => {
    const fixture = await createFixture({ status: "judging" });
    const result = await submit(submissionForm(fixture, 0));
    expect((result as { formError?: string }).formError).toContain(
      "Submissions are closed",
    );
  });

  it("blocks only on a DEFINITE missing repo, not an unknown one", async () => {
    const fixture = await createFixture();
    checkRepoMock.mockResolvedValue(false);
    const result = await submit(submissionForm(fixture, 0));
    expect(
      (result as { fieldErrors?: Record<string, string[]> }).fieldErrors?.repoUrl?.[0],
    ).toContain("couldn't reach");

    checkRepoMock.mockResolvedValue("unknown");
    expect(await submit(submissionForm(fixture, 1))).toEqual({ redirected: true });
  });

  it("rejects a token from a different event", async () => {
    const [a, b] = await Promise.all([createFixture(), createFixture()]);
    const form = submissionForm(a, 0);
    form.set("token", b.participantTokens[0]);
    const result = await submit(form);
    expect((result as { ok: boolean }).ok).toBe(false);
  });
});

describe("sendSubmissionInvites", () => {
  it("emails every registered builder once and skips them on a second press", async () => {
    const fixture = await createFixture();
    const first = await sendSubmissionInvites(fixture.eventId);
    // The fixture already minted a participant token each, so those are skipped.
    expect(first).toMatchObject({ ok: true, skipped: 3, sent: 0 });

    await db
      .delete(magicLinkTokens)
      .where(eq(magicLinkTokens.eventId, fixture.eventId));
    const second = await sendSubmissionInvites(fixture.eventId);
    expect(second).toMatchObject({ ok: true, sent: 3 });
    expect(sendMock).toHaveBeenCalledTimes(3);

    const third = await sendSubmissionInvites(fixture.eventId);
    expect(third).toMatchObject({ ok: true, sent: 0, skipped: 3 });
  });

  it("refuses when the event isn't live", async () => {
    const fixture = await createFixture({ status: "judging" });
    expect(await sendSubmissionInvites(fixture.eventId)).toMatchObject({
      ok: false,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("openJudging / closeJudging", () => {
  it("refuses to open judging on an empty room", async () => {
    const fixture = await createFixture();
    const result = await openJudging(fixture.eventId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No projects have been submitted");
  });

  it("moves live → judging → completed and audits both", async () => {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));

    expect(await openJudging(fixture.eventId)).toEqual({ ok: true });
    expect(await closeJudging(fixture.eventId)).toEqual({ ok: true });

    const [event] = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, fixture.eventId));
    expect(event.status).toBe("completed");

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventId, fixture.eventId));
    const changes = rows.filter((r) => r.action === "event.status_changed");
    expect(changes.map((r) => r.toValue).sort()).toEqual(["completed", "judging"]);
  });

  it("refuses to close judging that was never opened", async () => {
    const fixture = await createFixture();
    expect((await closeJudging(fixture.eventId)).ok).toBe(false);
  });
});

describe("saveScorecard", () => {
  async function liveJudging(weights?: (string | null)[]) {
    const fixture = await createFixture({ weights });
    await submit(submissionForm(fixture, 0));
    await openJudging(fixture.eventId);
    return { fixture, submissionId: await submissionIdFor(fixture.eventId) };
  }

  it("saves a complete card as final and computes the score", async () => {
    const { fixture, submissionId } = await liveJudging();
    const result = await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 3], "final"),
    );
    expect(result).toMatchObject({ ok: true, saved: "final" });

    const [card] = await db
      .select()
      .from(judgeScores)
      .where(eq(judgeScores.submissionId, submissionId));
    expect(card.isDraft).toBe(false);
    expect(Number(card.finalScore)).toBe(4);
    expect(card.submittedAt).toBeInstanceOf(Date);
  });

  it("keeps a partial card as a draft instead of throwing the work away", async () => {
    const { fixture, submissionId } = await liveJudging();
    const result = await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [4, null], "final"),
    );
    expect(result.ok).toBe(false);
    expect(result.formError).toContain("Saved as a draft");

    const [card] = await db
      .select()
      .from(judgeScores)
      .where(eq(judgeScores.submissionId, submissionId));
    // The one score they DID give is on disk, not lost to a validation error.
    expect(card.isDraft).toBe(true);
    expect((card.scores as Record<string, number>)[fixture.criterionIds[0]]).toBe(4);
  });

  it("lets a judge change a submitted card while scoring is open", async () => {
    const { fixture, submissionId } = await liveJudging();
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 5], "final"),
    );
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [2, 2], "final"),
    );

    const cards = await db
      .select()
      .from(judgeScores)
      .where(eq(judgeScores.submissionId, submissionId));
    // One row per (submission, judge) — an update, never a second card.
    expect(cards).toHaveLength(1);
    expect(Number(cards[0].finalScore)).toBe(2);
  });

  it("applies criterion weights", async () => {
    const { fixture, submissionId } = await liveJudging(["2.000", "1.000"]);
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 2], "final"),
    );
    const [card] = await db
      .select()
      .from(judgeScores)
      .where(eq(judgeScores.submissionId, submissionId));
    expect(Number(card.finalScore)).toBe(4);
  });

  it("rejects a score outside 1-5", async () => {
    const { fixture, submissionId } = await liveJudging();
    const form = scoreForm(fixture, 0, submissionId, [5, 5], "final");
    form.set(`score_${fixture.criterionIds[0]}`, "9");
    const result = await saveScorecard(initialScorecardState, form);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.[fixture.criterionIds[0]]).toContain("1 to 5");
  });

  it("refuses once scoring is closed", async () => {
    const { fixture, submissionId } = await liveJudging();
    await closeJudging(fixture.eventId);
    const result = await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 5], "final"),
    );
    expect(result.formError).toContain("Scoring is closed");
  });

  it("refuses a judge scoring another event's project", async () => {
    const a = await liveJudging();
    const b = await liveJudging();
    const form = scoreForm(a.fixture, 0, b.submissionId, [5, 5], "final");
    const result = await saveScorecard(initialScorecardState, form);
    // Scoped by the token's event, so a cross-event submission id is a miss.
    expect(result.formError).toContain("couldn't find that project");
  });
});

describe("loadJudgingPacket", () => {
  it("returns only this judge's own cards", async () => {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));
    await openJudging(fixture.eventId);
    const submissionId = await submissionIdFor(fixture.eventId);

    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 5], "final"),
    );

    const own = await loadJudgingPacket({
      eventId: fixture.eventId,
      judgeId: fixture.judgeIds[0],
    });
    expect(own.submissions[0].card?.isDraft).toBe(false);

    const other = await loadJudgingPacket({
      eventId: fixture.eventId,
      judgeId: fixture.judgeIds[1],
    });
    expect(other.submissions[0].card).toBeNull();
  });
});

describe("loadResults", () => {
  async function scoredEvent() {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));
    await submit(
      submissionForm(fixture, 1, {
        team_name: "Second Team",
        repo_url: "https://github.com/wr/second",
      }),
    );
    await openJudging(fixture.eventId);
    const rows = await db
      .select({ id: submissions.id, teamName: submissions.teamName })
      .from(submissions)
      .where(eq(submissions.eventId, fixture.eventId));
    return { fixture, rows };
  }

  it("counts submitted cards and ignores drafts", async () => {
    const { fixture, rows } = await scoredEvent();
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, rows[0].id, [5, 5], "final"),
    );
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 1, rows[0].id, [1, 1], "draft"),
    );

    const results = await loadResults(fixture.eventId);
    const row = results!.rows.find((r) => r.submissionId === rows[0].id)!;
    // The draft 1s would have dragged the average to 3 if they counted.
    expect(row.average).toBe(5);
    expect(row.judgeCount).toBe(1);
    expect(results!.judgeProgress[1].drafted).toBe(1);
  });

  it("surfaces a tie rather than ordering it away", async () => {
    const { fixture, rows } = await scoredEvent();
    for (const row of rows) {
      await saveScorecard(
        initialScorecardState,
        scoreForm(fixture, 0, row.id, [4, 4], "final"),
      );
    }

    const results = await loadResults(fixture.eventId);
    expect(results!.ties).toHaveLength(1);
    expect(results!.ties[0]).toHaveLength(2);
    expect(results!.ties[0].every((r) => r.average === 4)).toBe(true);
  });
});

describe("awards", () => {
  async function completedEvent() {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));
    await openJudging(fixture.eventId);
    const submissionId = await submissionIdFor(fixture.eventId);
    await saveScorecard(
      initialScorecardState,
      scoreForm(fixture, 0, submissionId, [5, 4], "final"),
    );
    return { fixture, submissionId };
  }

  it("creates an award, assigns a winner, and announces it as a separate step", async () => {
    const { fixture, submissionId } = await completedEvent();
    expect(await createAwardCategory(fixture.eventId, { label: "Best Overall" })).toEqual(
      { ok: true },
    );

    const [award] = await db
      .select()
      .from(awardCategories)
      .where(eq(awardCategories.eventId, fixture.eventId));
    expect(award.winningSubmissionId).toBeNull();

    // Announcing without a winner is refused — the two steps are distinct.
    expect((await announceAward(fixture.eventId, award.id)).ok).toBe(false);

    expect(
      await setAwardWinner(fixture.eventId, award.id, submissionId),
    ).toEqual({ ok: true });
    expect(await announceAward(fixture.eventId, award.id)).toEqual({ ok: true });

    const [announced] = await db
      .select()
      .from(awardCategories)
      .where(eq(awardCategories.id, award.id));
    expect(announced.announcedAt).toBeInstanceOf(Date);
  });

  it("locks the winner once announced", async () => {
    const { fixture, submissionId } = await completedEvent();
    await createAwardCategory(fixture.eventId, { label: "Best Overall" });
    const [award] = await db
      .select()
      .from(awardCategories)
      .where(eq(awardCategories.eventId, fixture.eventId));
    await setAwardWinner(fixture.eventId, award.id, submissionId);
    await announceAward(fixture.eventId, award.id);

    const result = await setAwardWinner(fixture.eventId, award.id, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already been announced");
  });

  it("refuses a criterion or a project from another event", async () => {
    const a = await completedEvent();
    const b = await completedEvent();

    expect(
      await createAwardCategory(a.fixture.eventId, {
        label: "Cross Event",
        criterionId: b.fixture.criterionIds[0],
      }),
    ).toMatchObject({ ok: false });

    await createAwardCategory(a.fixture.eventId, { label: "Best Overall" });
    const [award] = await db
      .select()
      .from(awardCategories)
      .where(eq(awardCategories.eventId, a.fixture.eventId));
    expect(
      await setAwardWinner(a.fixture.eventId, award.id, b.submissionId),
    ).toMatchObject({ ok: false });
  });
});

describe("sendScoringLinks", () => {
  it("emails each judge once, then skips them", async () => {
    const fixture = await createFixture();
    await submit(submissionForm(fixture, 0));
    await openJudging(fixture.eventId);

    expect(await sendScoringLinks(fixture.eventId)).toMatchObject({
      ok: true,
      sent: 2,
    });
    expect(await sendScoringLinks(fixture.eventId)).toMatchObject({
      ok: true,
      sent: 0,
      skipped: 2,
    });
    // An explicit resend is still possible.
    expect(
      await sendScoringLinks(fixture.eventId, { resend: true }),
    ).toMatchObject({ ok: true, sent: 2 });
  });

  it("refuses before judging is open", async () => {
    const fixture = await createFixture();
    expect(await sendScoringLinks(fixture.eventId)).toMatchObject({ ok: false });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

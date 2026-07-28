/**
 * Judge invitation + background form, against a REAL local Postgres.
 * Email is mocked; everything else is real.
 */
import "dotenv/config";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { splitJudgeLetters } from "../agents/handlers/judge-invitation-prompts";
import { db } from "../db";
import {
  auditLog,
  criteria,
  events,
  generatedAssets,
  judges,
  magicLinkTokens,
  organizations,
  sponsorApplications,
} from "../db/schema";
import { saveJudgeBackground } from "./actions";
import { redeemJudgeToken } from "./access";
import { initialJudgeFormState } from "./form-state";
import { sendJudgeInvitations } from "./send";

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  judgeIds: string[];
  judgeEmails: string[];
  pocEmail: string;
}

async function createFixture(
  options: { reviewStatus?: "pending" | "approved"; body?: string } = {},
): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const pocEmail = `poc-${suffix}@example.org`;

  const [org] = await db
    .insert(organizations)
    .values({ name: `Judge Test Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail,
      pocPhone: "+15415551234",
      painPoints: "Shelter data is scattered.",
      goalsNeeds: "One view.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `judge-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: "intake_complete",
    })
    .returning({ id: events.id });

  await db.insert(criteria).values({
    eventId: event.id,
    label: "Impact",
    description: "Who it helps",
    sortOrder: 0,
  });

  const emails = [`ada-${suffix}@example.org`, `grace-${suffix}@example.org`];
  const judgeRows = await db
    .insert(judges)
    .values([
      { eventId: event.id, name: "Ada Lovelace", email: emails[0] },
      { eventId: event.id, name: "Grace Hopper", email: emails[1] },
    ])
    .returning({ id: judges.id });

  await db.insert(generatedAssets).values({
    eventId: event.id,
    type: "judge_email",
    title: "Judge invitations",
    body:
      options.body ??
      `## JUDGE: ${emails[0]}\n\nDear Ada, please judge.\n\n## JUDGE: ${emails[1]}\n\nDear Grace, please judge.`,
    version: 1,
    reviewStatus: (options.reviewStatus ?? "approved") as "approved",
  });

  return {
    eventId: event.id,
    judgeIds: judgeRows.map((j) => j.id),
    judgeEmails: emails,
    pocEmail,
  };
}

/** The raw token can only be recovered from the email that carried it. */
function tokenFromLastEmail(): string {
  const call = sendMock.mock.calls.at(-1);
  const text = String(call?.[0]?.text ?? "");
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error("no token in the email");
  return match[1];
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "test" });
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
      await db.delete(magicLinkTokens).where(inArray(magicLinkTokens.eventId, eventIds));
      await db.delete(generatedAssets).where(inArray(generatedAssets.eventId, eventIds));
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(judges).where(inArray(judges.eventId, eventIds));
      await db.delete(criteria).where(inArray(criteria.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("splitJudgeLetters", () => {
  it("splits on the judge marker and keeps each letter with its address", () => {
    const letters = splitJudgeLetters(
      "## JUDGE: a@x.org\n\nDear A.\n\n## JUDGE: b@x.org\n\nDear B.",
    );
    expect(letters).toEqual([
      { email: "a@x.org", body: "Dear A." },
      { email: "b@x.org", body: "Dear B." },
    ]);
  });

  it("tolerates angle brackets around the address", () => {
    expect(splitJudgeLetters("## JUDGE: <a@x.org>\n\nDear A.")[0].email).toBe("a@x.org");
  });

  it("yields nothing when the draft has no markers", () => {
    // Sending one undifferentiated letter to everybody would be worse than
    // sending none, so an unmarked draft produces no letters at all.
    expect(splitJudgeLetters("Dear judges, please judge.")).toEqual([]);
  });

  it("drops a marker with no letter under it", () => {
    expect(splitJudgeLetters("## JUDGE: a@x.org\n\n")).toEqual([]);
  });
});

describe("sendJudgeInvitations", () => {
  it("refuses to send a draft that hasn't been approved", async () => {
    const fixture = await createFixture({ reviewStatus: "pending" });
    const outcome = await sendJudgeInvitations(fixture.eventId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/needs? approving/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses a draft with no per-judge markers", async () => {
    const fixture = await createFixture({ body: "Dear judges, please judge." });
    const outcome = await sendJudgeInvitations(fixture.eventId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/no per-judge letters/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emails each judge their own letter and their own link", async () => {
    const fixture = await createFixture();
    const outcome = await sendJudgeInvitations(fixture.eventId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(2);

    const recipients = sendMock.mock.calls.map((c) => c[0].to);
    expect(recipients.sort()).toEqual([...fixture.judgeEmails].sort());

    // Each letter goes only to the judge it was written for.
    const adaCall = sendMock.mock.calls.find((c) => c[0].to === fixture.judgeEmails[0]);
    expect(adaCall![0].text).toContain("Dear Ada");
    expect(adaCall![0].text).not.toContain("Dear Grace");

    // One live token per judge, and the links differ.
    const tokens = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.eventId, fixture.eventId),
          eq(magicLinkTokens.role, "judge"),
        ),
      );
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens.map((t) => t.subjectId)).size).toBe(2);

    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.eventId, fixture.eventId))
    ).map((r) => r.action);
    expect(actions.filter((a) => a === "judge_email.sent")).toHaveLength(2);
  });

  it("skips a judge who already has a live link rather than emailing twice", async () => {
    const fixture = await createFixture();
    await sendJudgeInvitations(fixture.eventId);
    sendMock.mockClear();

    const second = await sendJudgeInvitations(fixture.eventId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(2);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never sends a letter addressed to someone who isn't a judge here", async () => {
    // An address the agent invented or mistyped must not receive an invitation.
    const fixture = await createFixture({
      body: "## JUDGE: nobody@example.org\n\nDear stranger.",
    });
    const outcome = await sendJudgeInvitations(fixture.eventId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toBe(0);
    expect(outcome.unmatched).toEqual(["nobody@example.org"]);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("judge background form", () => {
  async function sentFixture() {
    const fixture = await createFixture();
    await sendJudgeInvitations(fixture.eventId);
    return { fixture, token: tokenFromLastEmail() };
  }

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  }

  it("opens with the judge's own row and saves their background", async () => {
    const { fixture, token } = await sentFixture();

    const access = await redeemJudgeToken({ rawToken: token, eventId: fixture.eventId });
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.access.judge.email).toBe(fixture.judgeEmails[1]);
    expect(access.access.judge.backgroundCompletedAt).toBeNull();

    sendMock.mockClear();
    const state = await saveJudgeBackground(
      initialJudgeFormState,
      form({
        event_id: fixture.eventId,
        token,
        name: "Grace Hopper",
        title: "Rear Admiral",
        bio: "Wrote the first compiler.",
        expertise_tags: "compilers, systems, compilers",
        intro_preference: "Please don't mention the nanoseconds.",
      }),
    );

    expect(state.status).toBe("saved");
    const [row] = await db
      .select()
      .from(judges)
      .where(eq(judges.id, access.access.judge.id));
    expect(row.title).toBe("Rear Admiral");
    expect(row.bio).toBe("Wrote the first compiler.");
    expect(row.expertiseTags).toEqual(["compilers", "systems", "compilers"]);
    expect(row.backgroundCompletedAt).not.toBeNull();
    // No question asked, so nobody was emailed.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("routes a criteria question to WR Admin and the sponsor POC", async () => {
    const { fixture, token } = await sentFixture();
    sendMock.mockClear();

    await saveJudgeBackground(
      initialJudgeFormState,
      form({
        event_id: fixture.eventId,
        token,
        name: "Grace Hopper",
        criteria_questions: "Is impact weighted above craft?",
      }),
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toContain(fixture.pocEmail);
    expect(message.text).toContain("Is impact weighted above craft?");
    // Replying reaches the judge who asked.
    expect(message.replyTo).toBe(fixture.judgeEmails[1]);
  });

  it("doesn't re-notify when the question is unchanged", async () => {
    const { fixture, token } = await sentFixture();
    const fields = {
      event_id: fixture.eventId,
      token,
      name: "Grace Hopper",
      criteria_questions: "Same question.",
    };
    await saveJudgeBackground(initialJudgeFormState, form(fields));
    sendMock.mockClear();

    await saveJudgeBackground(initialJudgeFormState, form(fields));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses a garbage token and writes nothing", async () => {
    const { fixture } = await sentFixture();
    const state = await saveJudgeBackground(
      initialJudgeFormState,
      form({
        event_id: fixture.eventId,
        token: "not-a-real-token",
        name: "Impostor",
      }),
    );
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/isn't valid/);
  });

  it("refuses a judge token from another event", async () => {
    const { token } = await sentFixture();
    const other = await createFixture();

    const state = await saveJudgeBackground(
      initialJudgeFormState,
      form({ event_id: other.eventId, token, name: "Wrong event" }),
    );
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/different Rogue Raise/);
  });

  it("requires a name to introduce them by", async () => {
    const { fixture, token } = await sentFixture();
    const state = await saveJudgeBackground(
      initialJudgeFormState,
      form({ event_id: fixture.eventId, token, name: "  " }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.name?.[0]).toMatch(/name/i);
  });

  it("leaves live tokens untouched by another judge's token", async () => {
    const { fixture, token } = await sentFixture();
    const live = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.eventId, fixture.eventId),
          isNull(magicLinkTokens.revokedAt),
        ),
      );
    expect(live).toHaveLength(2);
    expect(token).toBeTruthy();
  });
});

/**
 * Participant registration + the public landing page, against a REAL local
 * Postgres. Email and the GitHub existence check are mocked; everything else
 * is real.
 */
import "dotenv/config";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, checkUserMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  checkUserMock: vi.fn(),
}));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("../integrations/github", () => ({
  checkGithubUser: checkUserMock,
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import { db } from "../db";
import {
  auditLog,
  events,
  generatedAssets,
  organizations,
  participants,
  sponsorApplications,
} from "../db/schema";
import { loadLandingPage, parseFaq, parseLandingCopy } from "../events/landing";
import { getSpamGuard } from "../integrations/spam";
import { registerParticipant } from "./actions";
import { ROGUE_RAISE_RULES } from "./emails";
import { initialRegistrationState } from "./form-state";
import { participantSchema } from "./schema";

const createdOrgIds: string[] = [];

async function createEvent(
  options: { status?: string; copy?: string; faq?: string } = {},
): Promise<{ slug: string; eventId: string }> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Participant Org ${suffix}` })
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

  const slug = `participant-test-${suffix}`;
  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "registration_open") as "registration_open",
      confirmedFridayKickoffAt: new Date("2026-08-15T00:00:00.000Z"),
    })
    .returning({ id: events.id });

  if (options.copy) {
    await db.insert(generatedAssets).values({
      eventId: event.id,
      type: "landing_page_content",
      body: options.copy,
      version: 1,
      reviewStatus: "approved",
    });
  }
  if (options.faq) {
    await db.insert(generatedAssets).values({
      eventId: event.id,
      type: "faq",
      body: options.faq,
      version: 1,
      reviewStatus: "approved",
    });
  }

  return { slug, eventId: event.id };
}

/**
 * A genuine, signed challenge backdated so the guard's real-clock check sees a
 * human-plausible elapsed window (>= 3s) without sleeping. Fake timers are used
 * only to issue it, then restored immediately so the real DB calls are untouched.
 */
function backdatedChallenge(ageMs = 5_000) {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() - ageMs);
  const challenge = getSpamGuard().issueChallenge();
  vi.useRealTimers();
  return challenge;
}

function registrationForm(
  slug: string,
  overrides: Record<string, string> = {},
): FormData {
  const challenge = backdatedChallenge();
  const data = new FormData();
  data.set("event_slug", slug);
  data.set("first_name", "Ada");
  data.set("last_name", "Lovelace");
  data.set("email", `ada-${crypto.randomUUID()}@example.org`);
  data.set("github_username", "ada");
  data.set("challenge_ts", challenge.renderedAt);
  data.set("challenge_sig", challenge.sig);
  data.set("contact_time", "");
  for (const [k, v] of Object.entries(overrides)) data.set(k, v);
  return data;
}

/** The action redirects on success, which throws NEXT_REDIRECT. */
async function register(form: FormData) {
  try {
    return await registerParticipant(initialRegistrationState, form);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) {
      return { redirected: true } as const;
    }
    throw err;
  }
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "test" });
  checkUserMock.mockReset();
  checkUserMock.mockResolvedValue(true);
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
      await db.delete(participants).where(inArray(participants.eventId, eventIds));
      await db.delete(generatedAssets).where(inArray(generatedAssets.eventId, eventIds));
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

describe("participantSchema", () => {
  it("accepts a plain username", () => {
    expect(participantSchema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.org",
      githubUsername: "ada-lovelace",
    }).githubUsername).toBe("ada-lovelace");
  });

  it("accepts a pasted profile URL, which is how people actually answer", () => {
    const parsed = participantSchema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.org",
      githubUsername: "https://github.com/ada-lovelace/",
    });
    expect(parsed.githubUsername).toBe("ada-lovelace");
  });

  it("rejects usernames GitHub itself wouldn't allow", () => {
    for (const bad of ["-ada", "ada-", "ada--lovelace", "ada lovelace", "a".repeat(40)]) {
      expect(
        participantSchema.safeParse({
          firstName: "Ada",
          lastName: "L",
          email: "a@b.org",
          githubUsername: bad,
        }).success,
      ).toBe(false);
    }
  });
});

describe("registerParticipant", () => {
  it("registers a builder and emails them the rules", async () => {
    const { slug, eventId } = await createEvent();
    const form = registrationForm(slug);
    const email = String(form.get("email"));

    const result = await register(form);
    expect(result).toEqual({ redirected: true });

    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.eventId, eventId));
    expect(row.email).toBe(email);
    expect(row.githubUsername).toBe("ada");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe(email);
    // The confirmation carries the rules — that's the AC.
    for (const rule of ROGUE_RAISE_RULES) {
      expect(message.text).toContain(rule);
    }
    expect(message.text).toContain("Kickoff at 5:00 PM");

    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.eventId, eventId))
    ).map((r) => r.action);
    expect(actions).toContain("participant.registered");
  });

  it("refuses when registration isn't open, and writes nothing", async () => {
    const { slug, eventId } = await createEvent({ status: "live" });

    const result = await register(registrationForm(slug));

    expect(result).toMatchObject({ ok: false });
    expect((result as { formError?: string }).formError).toMatch(/isn't open/);
    expect(
      await db.select().from(participants).where(eq(participants.eventId, eventId)),
    ).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email gracefully, and doesn't email twice", async () => {
    const { slug, eventId } = await createEvent();
    const form = registrationForm(slug);
    const email = String(form.get("email"));
    await register(form);
    sendMock.mockClear();

    const second = await register(registrationForm(slug, { email: email.toUpperCase() }));

    expect(second).toMatchObject({ ok: false });
    expect((second as { formError?: string }).formError).toMatch(/already registered/);
    expect(
      await db.select().from(participants).where(eq(participants.eventId, eventId)),
    ).toHaveLength(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("tells someone their GitHub account doesn't exist", async () => {
    const { slug } = await createEvent();
    checkUserMock.mockResolvedValue(false);

    const result = await register(registrationForm(slug, { github_username: "nope" }));

    expect(result).toMatchObject({ ok: false });
    expect(
      (result as { fieldErrors?: Record<string, string[]> }).fieldErrors?.githubUsername?.[0],
    ).toMatch(/couldn't find github.com\/nope/);
  });

  it("lets someone through when the existence check can't answer", async () => {
    // A rate limit is our problem, not theirs.
    const { slug, eventId } = await createEvent();
    checkUserMock.mockResolvedValue("unknown");

    const result = await register(registrationForm(slug));

    expect(result).toEqual({ redirected: true });
    expect(
      await db.select().from(participants).where(eq(participants.eventId, eventId)),
    ).toHaveLength(1);
  });

  it("keeps what they typed when validation fails", async () => {
    const { slug } = await createEvent();
    const result = await register(
      registrationForm(slug, { email: "not-an-email", first_name: "Ada" }),
    );
    expect((result as { values?: { firstName: string } }).values?.firstName).toBe("Ada");
  });

  it("silently refuses a bot that fills the honeypot", async () => {
    const { slug, eventId } = await createEvent();
    const result = await register(registrationForm(slug, { contact_time: "now" }));

    expect(result).toMatchObject({ ok: false });
    expect(
      await db.select().from(participants).where(eq(participants.eventId, eventId)),
    ).toHaveLength(0);
  });
});

describe("landing page copy parsing", () => {
  it("pulls the headline, summary, and bullet sections out of the agent's copy", () => {
    const parsed = parseLandingCopy(
      [
        "## Headline",
        "Build a bed board in a weekend",
        "",
        "## Summary",
        "Shelters track beds by email. Let's fix that.",
        "",
        "## Who should come",
        "- Developers",
        "- Designers",
      ].join("\n"),
    );
    expect(parsed.headline).toBe("Build a bed board in a weekend");
    expect(parsed.summary).toContain("track beds by email");
    expect(parsed.sections).toEqual([
      { heading: "Who should come", bullets: ["Developers", "Designers"] },
    ]);
  });

  it("parses the FAQ into question and answer pairs", () => {
    const faq = parseFaq("### Do I need to code?\n\nNo.\n\n### What does it cost?\n\nNothing.");
    expect(faq).toEqual([
      { question: "Do I need to code?", answer: "No." },
      { question: "What does it cost?", answer: "Nothing." },
    ]);
  });
});

describe("loadLandingPage", () => {
  it("renders approved copy and the schedule from the event", async () => {
    const { slug } = await createEvent({
      copy: "## Headline\nBuild a bed board\n\n## Summary\nA weekend of it.",
      faq: "### Do I need to code?\n\nNo.",
    });

    const page = await loadLandingPage(slug);

    expect(page!.headline).toBe("Build a bed board");
    expect(page!.faq).toHaveLength(1);
    // The schedule comes from the event, never from the copy.
    expect(page!.scheduleLines.some((l) => l.includes("Kickoff"))).toBe(true);
    expect(page!.weekendLabel).toBe("Aug 14–16, 2026");
    expect(page!.registrationOpen).toBe(true);
  });

  it("falls back to the sponsor's own words when nothing is approved", async () => {
    const { slug } = await createEvent();
    const page = await loadLandingPage(slug);
    expect(page!.summary).toContain("Shelter capacity data lives in spreadsheets.");
  });

  it("ignores copy that hasn't been approved", async () => {
    const { slug, eventId } = await createEvent();
    await db.insert(generatedAssets).values({
      eventId,
      type: "landing_page_content",
      body: "## Headline\nUnreviewed and public",
      version: 1,
      reviewStatus: "pending",
    });

    const page = await loadLandingPage(slug);
    // An unreviewed draft must never reach a public page.
    expect(page!.headline).not.toBe("Unreviewed and public");
  });

  it("counts registered builders", async () => {
    const { slug } = await createEvent();
    await register(registrationForm(slug));
    expect((await loadLandingPage(slug))!.participantCount).toBe(1);
  });
});

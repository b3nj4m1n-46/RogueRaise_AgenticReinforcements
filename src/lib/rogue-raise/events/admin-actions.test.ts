/**
 * Integration tests for the admin event actions against a REAL local Postgres.
 * Same harness as the sponsor/intake suites: "dotenv/config" first, email +
 * next/cache mocked, the database real.
 */
import "dotenv/config";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "../db";
import {
  auditLog,
  dateOptions,
  events,
  magicLinkTokens,
  organizations,
  sponsorApplications,
} from "../db/schema";
import { buildFridayKickoff } from "../intake/schedule";
import {
  generateMagicToken,
  hashMagicToken,
  MAGIC_LINK_TTL_MS,
} from "../sponsors/magic-link";
import { confirmEventWeekend, resendIntakeInvite } from "./admin-actions";
import { loadAdminEvent, listAdminEvents } from "./queries";
import { initialAdminEventState } from "./state";

const FRIDAY_A = "2026-08-14";
const FRIDAY_B = "2026-08-21";
const FRIDAY_C = "2026-08-28";

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  applicationId: string;
  optionIds: string[];
  pocEmail: string;
}

async function createFixture(
  options: { status?: string; weekends?: string[] } = {},
): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const pocEmail = `poc-${suffix}@example.org`;

  const [org] = await db
    .insert(organizations)
    .values({ name: `Event Test Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail,
      pocPhone: "+15415551234",
      painPoints: "Spreadsheets everywhere.",
      goalsNeeds: "One source of truth.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `event-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "intake_complete") as "intake_complete",
    })
    .returning({ id: events.id });

  const weekends = options.weekends ?? [FRIDAY_A, FRIDAY_B];
  const optionRows = weekends.length
    ? await db
        .insert(dateOptions)
        .values(
          weekends.map((friday) => ({
            eventId: event.id,
            fridayKickoffAt: buildFridayKickoff(friday),
          })),
        )
        .returning({ id: dateOptions.id })
    : [];

  return {
    eventId: event.id,
    applicationId: application.id,
    optionIds: optionRows.map((o) => o.id),
    pocEmail,
  };
}

function confirmForm(eventId: string, optionId: string): FormData {
  const formData = new FormData();
  formData.set("event_id", eventId);
  formData.set("date_option_id", optionId);
  return formData;
}

function resendForm(eventId: string): FormData {
  const formData = new FormData();
  formData.set("event_id", eventId);
  return formData;
}

async function confirmedOptionIds(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ id: dateOptions.id })
    .from(dateOptions)
    .where(and(eq(dateOptions.eventId, eventId), eq(dateOptions.isConfirmed, true)));
  return rows.map((r) => r.id);
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
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(magicLinkTokens).where(inArray(magicLinkTokens.eventId, eventIds));
      await db.delete(dateOptions).where(inArray(dateOptions.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("confirmEventWeekend", () => {
  it("confirms one weekend and writes it to the event", async () => {
    const fixture = await createFixture();
    const state = await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[0]),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).toMatch(/Aug 14–16, 2026/);
    expect(await confirmedOptionIds(fixture.eventId)).toEqual([fixture.optionIds[0]]);

    const [event] = await db
      .select({ confirmed: events.confirmedFridayKickoffAt })
      .from(events)
      .where(eq(events.id, fixture.eventId));
    expect(event.confirmed?.toISOString()).toBe(
      buildFridayKickoff(FRIDAY_A).toISOString(),
    );
    expect(await auditActions(fixture.eventId)).toContain("event.weekend_confirmed");
  });

  it("moves the confirmation atomically — never two confirmed", async () => {
    const fixture = await createFixture({ weekends: [FRIDAY_A, FRIDAY_B, FRIDAY_C] });
    await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[0]),
    );
    await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[2]),
    );

    expect(await confirmedOptionIds(fixture.eventId)).toEqual([fixture.optionIds[2]]);

    const [event] = await db
      .select({ confirmed: events.confirmedFridayKickoffAt })
      .from(events)
      .where(eq(events.id, fixture.eventId));
    expect(event.confirmed?.toISOString()).toBe(
      buildFridayKickoff(FRIDAY_C).toISOString(),
    );
  });

  it("records the previous weekend as the audit from-value", async () => {
    const fixture = await createFixture();
    await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[0]),
    );
    await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[1]),
    );

    const rows = await db
      .select({ from: auditLog.fromValue, to: auditLog.toValue })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, fixture.eventId),
          eq(auditLog.action, "event.weekend_confirmed"),
        ),
      )
      .orderBy(auditLog.createdAt);

    expect(rows).toHaveLength(2);
    expect(rows[0].from).toBeNull();
    expect(rows[1].from).toBe(buildFridayKickoff(FRIDAY_A).toISOString());
    expect(rows[1].to).toBe(buildFridayKickoff(FRIDAY_B).toISOString());
  });

  it("refuses an option belonging to another event", async () => {
    const mine = await createFixture();
    const theirs = await createFixture();

    const state = await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(mine.eventId, theirs.optionIds[0]),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/doesn't belong to this event/);
    expect(await confirmedOptionIds(mine.eventId)).toEqual([]);
    expect(await confirmedOptionIds(theirs.eventId)).toEqual([]);
  });

  it("refuses once the event is live", async () => {
    const fixture = await createFixture({ status: "live" });
    const state = await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, fixture.optionIds[0]),
    );
    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/past the point/);
    expect(await confirmedOptionIds(fixture.eventId)).toEqual([]);
  });

  it("refuses a malformed id without touching the database", async () => {
    const fixture = await createFixture();
    const state = await confirmEventWeekend(
      initialAdminEventState,
      confirmForm(fixture.eventId, "not-a-uuid"),
    );
    expect(state.ok).toBe(false);
    expect(await confirmedOptionIds(fixture.eventId)).toEqual([]);
  });
});

describe("resendIntakeInvite", () => {
  async function liveTokenHashes(eventId: string): Promise<string[]> {
    const rows = await db
      .select({ hash: magicLinkTokens.tokenHash })
      .from(magicLinkTokens)
      .where(
        and(eq(magicLinkTokens.eventId, eventId), isNull(magicLinkTokens.revokedAt)),
      );
    return rows.map((r) => r.hash);
  }

  it("mints a fresh link, revokes the old one, and emails the POC", async () => {
    const fixture = await createFixture({ status: "intake_pending" });
    const original = generateMagicToken();
    await db.insert(magicLinkTokens).values({
      eventId: fixture.eventId,
      role: "sponsor_poc",
      subjectId: fixture.applicationId,
      email: fixture.pocEmail,
      tokenHash: original.hash,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });

    const state = await resendIntakeInvite(
      initialAdminEventState,
      resendForm(fixture.eventId),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).toContain(fixture.pocEmail);
    expect(state.notice).toMatch(/1 earlier link/);

    // Exactly one live token, and it is NOT the one we planted.
    const live = await liveTokenHashes(fixture.eventId);
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(original.hash);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe(fixture.pocEmail);
    expect(message.subject).toMatch(/fresh link/i);
    // The raw token reaches the email and nowhere else.
    const match = /token=([A-Za-z0-9_-]+)/.exec(message.text as string);
    expect(match).not.toBeNull();
    expect(hashMagicToken(match![1])).toBe(live[0]);

    expect(await auditActions(fixture.eventId)).toContain("magic_link.reissued");
  });

  it("works when there was never a token to revoke", async () => {
    const fixture = await createFixture({ status: "intake_pending" });
    const state = await resendIntakeInvite(
      initialAdminEventState,
      resendForm(fixture.eventId),
    );
    expect(state.ok).toBe(true);
    expect(state.notice).not.toMatch(/earlier link/);
    expect(await liveTokenHashes(fixture.eventId)).toHaveLength(1);
  });

  it("leaves an already-expired token alone rather than re-revoking it", async () => {
    const fixture = await createFixture({ status: "intake_pending" });
    const expired = generateMagicToken();
    await db.insert(magicLinkTokens).values({
      eventId: fixture.eventId,
      role: "sponsor_poc",
      subjectId: fixture.applicationId,
      email: fixture.pocEmail,
      tokenHash: expired.hash,
      expiresAt: new Date(Date.now() - 1000),
    });

    const state = await resendIntakeInvite(
      initialAdminEventState,
      resendForm(fixture.eventId),
    );

    expect(state.ok).toBe(true);
    expect(state.notice).not.toMatch(/earlier link/);
    const [row] = await db
      .select({ revokedAt: magicLinkTokens.revokedAt })
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, expired.hash));
    expect(row.revokedAt).toBeNull();
  });

  it("refuses once the event has moved past intake", async () => {
    const fixture = await createFixture({ status: "repo_generating" });
    const state = await resendIntakeInvite(
      initialAdminEventState,
      resendForm(fixture.eventId),
    );
    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/past the intake stage/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports the failure but keeps the new link when the email won't send", async () => {
    const fixture = await createFixture({ status: "intake_pending" });
    sendMock.mockRejectedValueOnce(new Error("smtp down"));

    const state = await resendIntakeInvite(
      initialAdminEventState,
      resendForm(fixture.eventId),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/didn't send/);
    expect(await liveTokenHashes(fixture.eventId)).toHaveLength(1);
    expect(await auditActions(fixture.eventId)).toContain(
      "magic_link.reissue_email_failed",
    );
  });
});

describe("admin read model", () => {
  it("reports intake progress per event without an N+1", async () => {
    const fixture = await createFixture();
    const rows = await listAdminEvents();
    const row = rows.find((r) => r.id === fixture.eventId);

    expect(row).toBeDefined();
    // Weekends are offered; supporting context and tech stack are not.
    expect(row!.completeness.complete).toBe(false);
    expect(
      row!.completeness.required.find((r) => r.key === "potential_dates")?.met,
    ).toBe(true);
    expect(
      row!.completeness.required.find((r) => r.key === "stakeholder_tech_stack")?.met,
    ).toBe(false);
  });

  it("expands every offered weekend to the canonical schedule", async () => {
    const fixture = await createFixture();
    const detail = await loadAdminEvent(fixture.eventId);

    expect(detail).not.toBeNull();
    expect(detail!.weekends).toHaveLength(2);
    const first = detail!.weekends[0].schedule;
    expect(first.fridayKickoffAt.toISOString()).toBe(
      buildFridayKickoff(FRIDAY_A).toISOString(),
    );
    // Sunday results are 6:00 PM Pacific, derived — never stored.
    expect(first.sundayResultsAt.getTime()).toBeGreaterThan(
      first.sundayPitchesAt.getTime(),
    );
    expect(detail!.application?.pocEmail).toBe(fixture.pocEmail);
  });

  it("returns null for an event that doesn't exist", async () => {
    expect(await loadAdminEvent(crypto.randomUUID())).toBeNull();
  });
});

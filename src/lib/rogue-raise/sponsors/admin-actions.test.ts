/**
 * Integration tests for the privileged WR-Admin curation actions against a REAL
 * local Postgres (DATABASE_URL from .env). Mirrors story 1's harness: "dotenv/config"
 * first, the email adapter + next/headers + next/cache mocked, and the DB real.
 *
 * The magic-link module is mocked at a single, honest seam so we can (a) capture the
 * raw/hash a happy-path approve mints (raw is never returned or stored) and (b) force
 * generateMagicToken to throw mid-transaction — AFTER the app + event UPDATEs — to
 * prove the whole transaction rolls back. Everything else in ./magic-link stays real.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// --- Mocks (hoisted above the module under test) ----------------------------

const { sendMock, magicControl } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  // `last` captures the raw/hash the real generator produced (raw never leaves
  // the action otherwise); `throwOnGenerate` forces a mid-transaction failure.
  magicControl: {
    throwOnGenerate: false,
    last: null as { raw: string; hash: string } | null,
  },
}));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));

// The action never reads headers, but story 1's harness stubs it; harmless parity.
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

// revalidatePath throws outside a Next request/render store — no-op it here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Single seam over ./magic-link: delegate to the real impl but capture/interpose.
vi.mock("./magic-link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./magic-link")>();
  return {
    ...actual,
    generateMagicToken: () => {
      if (magicControl.throwOnGenerate) {
        throw new Error("forced mid-transaction failure");
      }
      const token = actual.generateMagicToken();
      magicControl.last = token;
      return token;
    },
  };
});

import { db } from "../db";
import {
  auditLog,
  events,
  magicLinkTokens,
  organizations,
  sponsorApplications,
  stakeholders,
} from "../db/schema";
import {
  approveSponsorApplication,
  rejectSponsorApplication,
} from "./admin-actions";
import { initialAdminDecisionState } from "./admin-decision-state";
import { hashMagicToken, MAGIC_LINK_TTL_MS } from "./magic-link";

// --- Seed helpers -----------------------------------------------------------

/** Org ids created during a test, cleaned up (FK order) in afterEach. */
const createdOrgIds: string[] = [];

interface SeedOpts {
  appStatus?: "submitted" | "under_review" | "approved" | "rejected";
  eventStatus?: "submitted" | "intake_pending" | "rejected";
  eventCount?: number;
}

interface Seeded {
  orgId: string;
  applicationId: string;
  pocEmail: string;
  eventIds: string[];
}

/**
 * Insert org + application + N linked events DIRECTLY (not via the public action),
 * with unique names/slugs per test so runs never collide.
 */
async function seed(opts: SeedOpts = {}): Promise<Seeded> {
  const { appStatus = "submitted", eventStatus = "submitted", eventCount = 1 } =
    opts;

  const [org] = await db
    .insert(organizations)
    .values({ name: `Admin Test Org ${randomUUID()}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const pocEmail = `poc-${randomUUID()}@example.test`;
  const [app] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jane POC",
      pocEmail,
      pocPhone: "+15415551234",
      painPoints: "Our intake is painfully manual.",
      goalsNeeds: "We want an automated flow.",
      financialCommitmentAmount: "5000.00",
      financialCommitmentToDiscuss: false,
      status: appStatus,
      submittedAt: new Date(),
    })
    .returning({ id: sponsorApplications.id });

  const eventIds: string[] = [];
  for (let i = 0; i < eventCount; i++) {
    const [ev] = await db
      .insert(events)
      .values({
        orgId: org.id,
        sponsorApplicationId: app.id,
        slug: `admin-test-${randomUUID()}`,
        title: `Admin Test Event ${i}`,
        status: eventStatus,
      })
      .returning({ id: events.id });
    eventIds.push(ev.id);
  }

  return { orgId: org.id, applicationId: app.id, pocEmail, eventIds };
}

function decisionFormData(applicationId: string, note?: string): FormData {
  const fd = new FormData();
  fd.set("application_id", applicationId);
  if (note !== undefined) fd.set("note", note);
  return fd;
}

type AdminAction =
  | typeof approveSponsorApplication
  | typeof rejectSponsorApplication;

/** The action PRG-redirects on success (throws NEXT_REDIRECT to /admin/sponsors). */
async function expectRedirect(action: AdminAction, fd: FormData): Promise<void> {
  let error: unknown;
  try {
    await action(initialAdminDecisionState, fd);
  } catch (e) {
    error = e;
  }
  const digest = (error as { digest?: string } | undefined)?.digest ?? "";
  expect(digest).toContain("NEXT_REDIRECT");
  expect(digest).toContain("/admin/sponsors");
}

async function appById(id: string) {
  const [row] = await db
    .select()
    .from(sponsorApplications)
    .where(eq(sponsorApplications.id, id));
  return row;
}

async function eventById(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row;
}

async function tokensForEvent(eventId: string) {
  return db
    .select()
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.eventId, eventId));
}

async function auditForEvent(eventId: string) {
  return db.select().from(auditLog).where(eq(auditLog.eventId, eventId));
}

// --- Lifecycle --------------------------------------------------------------

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "dev" });
  magicControl.throwOnGenerate = false;
  magicControl.last = null;
});

afterEach(async () => {
  const ids = [...createdOrgIds];
  createdOrgIds.length = 0;
  if (ids.length === 0) return;

  const evs = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.orgId, ids));
  const evIds = evs.map((e) => e.id);

  if (evIds.length > 0) {
    await db
      .delete(magicLinkTokens)
      .where(inArray(magicLinkTokens.eventId, evIds));
    await db.delete(auditLog).where(inArray(auditLog.eventId, evIds));
    await db.delete(stakeholders).where(inArray(stakeholders.eventId, evIds));
  }
  await db.delete(events).where(inArray(events.orgId, ids));
  await db
    .delete(sponsorApplications)
    .where(inArray(sponsorApplications.orgId, ids));
  await db.delete(organizations).where(inArray(organizations.id, ids));
});

afterAll(async () => {
  await db.$client.end();
});

// --- Tests ------------------------------------------------------------------

describe("approveSponsorApplication (integration)", () => {
  it("approves: app→approved (note null when empty), event→intake_pending, mints exactly 1 token, 2 PII-free audit rows, 1 email, redirects", async () => {
    const { applicationId, pocEmail, eventIds } = await seed();
    const eventId = eventIds[0];

    await expectRedirect(
      approveSponsorApplication,
      decisionFormData(applicationId, ""),
    );

    // Application transitioned; empty note stored as null.
    const app = await appById(applicationId);
    expect(app.status).toBe("approved");
    expect(app.adminNote).toBeNull();

    // Event transitioned straight to intake_pending.
    const event = await eventById(eventId);
    expect(event.status).toBe("intake_pending");

    // Exactly one magic-link token, correctly shaped.
    const tokens = await tokensForEvent(eventId);
    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    expect(token.role).toBe("sponsor_poc");
    expect(token.email).toBe(pocEmail);
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // expires ≈ now + 14 days (±1 min).
    const expectedExpiry = Date.now() + MAGIC_LINK_TTL_MS;
    expect(Math.abs(token.expiresAt!.getTime() - expectedExpiry)).toBeLessThan(
      60_000,
    );

    // Stored hash === hashMagicToken(raw); the raw token is NEVER in the DB.
    expect(magicControl.last).not.toBeNull();
    const { raw, hash } = magicControl.last!;
    expect(token.tokenHash).toBe(hash);
    expect(token.tokenHash).toBe(hashMagicToken(raw));
    expect(token.tokenHash).not.toBe(raw);

    // Exactly two audit rows for this decision.
    const audit = await auditForEvent(eventId);
    expect(audit).toHaveLength(2);

    const appAudit = audit.find((a) => a.entity === "sponsor_application")!;
    expect(appAudit.action).toBe("sponsor_application.approved");
    expect(appAudit.fromValue).toBe("submitted");
    expect(appAudit.toValue).toBe("approved");

    const eventAudit = audit.find((a) => a.entity === "event")!;
    expect(eventAudit.action).toBe("event.intake_pending");
    expect(eventAudit.fromValue).toBe("submitted");
    expect(eventAudit.toValue).toBe("intake_pending");

    // Metadata is ids only — via + applicationId + eventId, NO PoC PII.
    for (const row of audit) {
      const meta = row.metadata as Record<string, unknown>;
      expect(meta.via).toBe("approve");
      expect(meta.applicationId).toBe(applicationId);
      expect(meta.eventId).toBe(eventId);
      expect(Object.keys(meta).sort()).toEqual([
        "applicationId",
        "eventId",
        "via",
      ]);
      expect(JSON.stringify(meta)).not.toContain(pocEmail);
      expect(JSON.stringify(meta)).not.toContain("+15415551234");
    }

    // Exactly one email — the intake invite to the POC, carrying the raw token.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      text?: string;
    };
    expect(message.to).toBe(pocEmail);
    expect(message.subject).toMatch(/approved/i);
    expect(message.text).toContain(`/sponsor/intake/${eventId}`);
    expect(message.text).toContain(raw);
  });

  it("persists a provided note, trimmed", async () => {
    const { applicationId } = await seed();
    await expectRedirect(
      approveSponsorApplication,
      decisionFormData(applicationId, "  Great fit for the program  "),
    );
    const app = await appById(applicationId);
    expect(app.adminNote).toBe("Great fit for the program");
  });
});

describe("rejectSponsorApplication (integration)", () => {
  it("rejects: app→rejected, event→rejected, 2 audit rows, sends decline email, redirects", async () => {
    const { applicationId, pocEmail, eventIds } = await seed();
    const eventId = eventIds[0];

    await expectRedirect(
      rejectSponsorApplication,
      decisionFormData(applicationId),
    );

    const app = await appById(applicationId);
    expect(app.status).toBe("rejected");

    const event = await eventById(eventId);
    expect(event.status).toBe("rejected");

    // Reject mints NO token.
    expect(await tokensForEvent(eventId)).toHaveLength(0);

    const audit = await auditForEvent(eventId);
    expect(audit).toHaveLength(2);
    const appAudit = audit.find((a) => a.entity === "sponsor_application")!;
    expect(appAudit.toValue).toBe("rejected");
    expect(appAudit.fromValue).toBe("submitted");
    const eventAudit = audit.find((a) => a.entity === "event")!;
    expect(eventAudit.toValue).toBe("rejected");
    for (const row of audit) {
      expect((row.metadata as Record<string, unknown>).via).toBe("reject");
    }

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0] as { to: string; subject: string };
    expect(message.to).toBe(pocEmail);
    expect(message.subject).toMatch(/update/i);
  });
});

describe("idempotency guard", () => {
  it("refuses an already-decided application and writes nothing new", async () => {
    const { applicationId, eventIds } = await seed({
      appStatus: "approved",
      eventStatus: "intake_pending",
    });
    const eventId = eventIds[0];

    const state = await approveSponsorApplication(
      initialAdminDecisionState,
      decisionFormData(applicationId),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/already been decided/i);

    // Counts unchanged: no token, no audit rows, no email.
    expect(await tokensForEvent(eventId)).toHaveLength(0);
    expect(await auditForEvent(eventId)).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();

    // State untouched.
    expect((await appById(applicationId)).status).toBe("approved");
    expect((await eventById(eventId)).status).toBe("intake_pending");
  });
});

describe("event-resolution guard", () => {
  it("refuses (no writes) when ZERO events resolve", async () => {
    const { applicationId } = await seed({ eventCount: 0 });

    const state = await approveSponsorApplication(
      initialAdminDecisionState,
      decisionFormData(applicationId),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/single event/i);
    expect((await appById(applicationId)).status).toBe("submitted");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses (no writes) when TWO events resolve", async () => {
    const { applicationId, eventIds } = await seed({ eventCount: 2 });

    const state = await approveSponsorApplication(
      initialAdminDecisionState,
      decisionFormData(applicationId),
    );

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/single event/i);

    // Nothing moved on either event, no tokens, no audit rows, no email.
    expect((await appById(applicationId)).status).toBe("submitted");
    for (const id of eventIds) {
      expect((await eventById(id)).status).toBe("submitted");
      expect(await tokensForEvent(id)).toHaveLength(0);
      expect(await auditForEvent(id)).toHaveLength(0);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("transaction rollback", () => {
  it("rolls back the app + event updates when a mid-transaction throw occurs", async () => {
    const { applicationId, eventIds } = await seed();
    const eventId = eventIds[0];

    // Force generateMagicToken (called AFTER both UPDATEs) to throw.
    magicControl.throwOnGenerate = true;

    const state = await approveSponsorApplication(
      initialAdminDecisionState,
      decisionFormData(applicationId),
    );

    // The action catches the tx failure and returns a generic form error.
    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/something went wrong/i);

    // Everything rolled back: the app + event UPDATEs did not persist.
    expect((await appById(applicationId)).status).toBe("submitted");
    expect((await eventById(eventId)).status).toBe("submitted");
    expect(await tokensForEvent(eventId)).toHaveLength(0);
    expect(await auditForEvent(eventId)).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("email-after-commit failure", () => {
  it("still commits the decision, audits email_failed (actor system), and redirects", async () => {
    const { applicationId, eventIds } = await seed();
    const eventId = eventIds[0];

    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error("smtp down"));

    await expectRedirect(
      approveSponsorApplication,
      decisionFormData(applicationId),
    );

    // Decision committed despite the send failure.
    expect((await appById(applicationId)).status).toBe("approved");
    expect((await eventById(eventId)).status).toBe("intake_pending");
    expect(await tokensForEvent(eventId)).toHaveLength(1);

    // The send was attempted once...
    expect(sendMock).toHaveBeenCalledTimes(1);

    // ...and the failure was audit-logged (actor "system"), not rolled back.
    const failAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, eventId),
          eq(auditLog.action, "sponsor_application.email_failed"),
        ),
      );
    expect(failAudit).toHaveLength(1);
    expect(failAudit[0].actor).toBe("system");
    expect(failAudit[0].entity).toBe("sponsor_application");

    // 2 decision rows + 1 email_failed row.
    expect(await auditForEvent(eventId)).toHaveLength(3);
  });
});

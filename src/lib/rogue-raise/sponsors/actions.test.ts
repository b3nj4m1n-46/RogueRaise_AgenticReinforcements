/**
 * Integration tests for the sponsor sign-up server action against a REAL local
 * Postgres (DATABASE_URL from .env). vitest does not auto-load .env, so we import
 * "dotenv/config" first. next/headers and the email adapter are mocked; the spam
 * guard, slug helper and DB are real.
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

// --- Mocks (hoisted above the imports of the module under test) -------------

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));

// headers() throws outside a request context; a stub with a no-op get() is enough
// for the action's IP-hashing helper (it tolerates all-null headers).
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import { db } from "../db";
import {
  auditLog,
  events,
  organizations,
  sponsorApplications,
  stakeholders,
} from "../db/schema";
import { getSpamGuard } from "../integrations/spam";
import {
  createSponsorApplication,
  initialSponsorFormState,
} from "./actions";
import { slugify } from "./slug";

// --- Test helpers -----------------------------------------------------------

/** Org names created during a test, cleaned up (FK order) in afterEach. */
const createdOrgNames: string[] = [];

function newOrgName(): string {
  const name = `Test Org ${randomUUID()}`;
  createdOrgNames.push(name);
  return name;
}

/**
 * A genuine, signed challenge backdated `ageMs` into the past so the action's
 * real-clock verify() sees a human-plausible elapsed window (>= 3s) without any
 * sleeping. Fake timers are used ONLY to issue the token, then immediately
 * restored so the real DB calls are untouched.
 */
function backdatedChallenge(ageMs = 5_000) {
  const base = Date.now() - ageMs;
  vi.useFakeTimers();
  vi.setSystemTime(base);
  const challenge = getSpamGuard().issueChallenge();
  vi.useRealTimers();
  return challenge;
}

interface BuildOpts {
  orgName: string;
  stakeholderCount?: number;
  honeypot?: string;
  challenge?: { renderedAt: string; sig: string } | null;
  overrides?: Record<string, string>;
}

function buildFormData(opts: BuildOpts): FormData {
  const {
    orgName,
    stakeholderCount = 1,
    honeypot = "",
    overrides = {},
  } = opts;
  const challenge =
    opts.challenge === null
      ? { renderedAt: "", sig: "" }
      : (opts.challenge ?? backdatedChallenge());

  const stakeholderList = Array.from({ length: stakeholderCount }, (_, i) => ({
    name: `Stakeholder ${i + 1}`,
    email: `stakeholder${i + 1}@example.test`,
    phone: "+15415550000",
  }));

  const fd = new FormData();
  fd.set("org_name", orgName);
  fd.set("poc_name", "Jane Doe");
  fd.set("poc_email", "jane@example.test");
  fd.set("poc_phone", "+15415551234");
  fd.set("pain_points", "Our intake process is painfully manual.");
  fd.set("goals_needs", "We want an automated flow by Q3.");
  fd.set("financial_mode", "amount");
  fd.set("financial_amount", "5000");
  fd.set("financial_note", "");
  fd.set("stakeholders_json", JSON.stringify(stakeholderList));
  fd.set("contact_time", honeypot); // honeypot
  fd.set("challenge_ts", challenge.renderedAt);
  fd.set("challenge_sig", challenge.sig);

  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

/**
 * The action PRG-redirects on success, which throws a NEXT_REDIRECT error.
 * Assert the throw and its target instead of a returned value.
 */
async function expectRedirectToThanks(fd: FormData): Promise<void> {
  let error: unknown;
  try {
    await createSponsorApplication(initialSponsorFormState, fd);
  } catch (e) {
    error = e;
  }
  const digest = (error as { digest?: string } | undefined)?.digest ?? "";
  expect(digest).toContain("NEXT_REDIRECT");
  expect(digest).toContain("/sponsor/thanks");
}

async function orgByName(name: string) {
  return db
    .select()
    .from(organizations)
    .where(eq(organizations.name, name));
}

// --- Lifecycle --------------------------------------------------------------

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "dev" });
});

afterEach(async () => {
  const names = [...createdOrgNames];
  createdOrgNames.length = 0;
  if (names.length === 0) return;

  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(inArray(organizations.name, names));
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return;

  const evs = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.orgId, orgIds));
  const evIds = evs.map((e) => e.id);

  if (evIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.eventId, evIds));
    await db.delete(stakeholders).where(inArray(stakeholders.eventId, evIds));
  }
  await db.delete(events).where(inArray(events.orgId, orgIds));
  await db
    .delete(sponsorApplications)
    .where(inArray(sponsorApplications.orgId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

afterAll(async () => {
  // Close the pool so the vitest worker exits cleanly.
  await db.$client.end();
});

// --- Tests ------------------------------------------------------------------

describe("createSponsorApplication (integration)", () => {
  it("happy path writes 1 org + 1 application + 1 event + N stakeholders + 1 audit row, all linked, and redirects", async () => {
    const orgName = newOrgName();
    const fd = buildFormData({ orgName, stakeholderCount: 3 });

    await expectRedirectToThanks(fd);

    const orgs = await orgByName(orgName);
    expect(orgs).toHaveLength(1);
    const orgId = orgs[0].id;

    const apps = await db
      .select()
      .from(sponsorApplications)
      .where(eq(sponsorApplications.orgId, orgId));
    expect(apps).toHaveLength(1);
    expect(apps[0].status).toBe("submitted");
    expect(apps[0].submittedAt).not.toBeNull();
    expect(apps[0].financialCommitmentToDiscuss).toBe(false);
    expect(apps[0].financialCommitmentAmount).not.toBeNull();

    const evs = await db
      .select()
      .from(events)
      .where(eq(events.orgId, orgId));
    expect(evs).toHaveLength(1);
    expect(evs[0].status).toBe("submitted");
    expect(evs[0].sponsorApplicationId).toBe(apps[0].id);
    expect(evs[0].title).toBe(orgName);
    expect(evs[0].slug.startsWith(`${slugify(orgName)}-`)).toBe(true);

    const sh = await db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.eventId, evs[0].id));
    expect(sh).toHaveLength(3);

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, evs[0].id),
          eq(auditLog.action, "sponsor_application.created"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].entity).toBe("sponsor_application");
    expect(audit[0].toValue).toBe("submitted");
    expect(audit[0].actor).toBe("public");
    const meta = audit[0].metadata as Record<string, unknown>;
    expect(meta.sponsorApplicationId).toBe(apps[0].id);
    expect(meta.orgId).toBe(orgId);
    expect(meta.stakeholderCount).toBe(3);

    // Both emails attempted, only after the commit.
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("reuses an existing organization on a second submission with the same name (no duplicate org)", async () => {
    const orgName = newOrgName();

    await expectRedirectToThanks(buildFormData({ orgName }));
    const afterFirst = await orgByName(orgName);
    expect(afterFirst).toHaveLength(1);
    const orgId = afterFirst[0].id;

    await expectRedirectToThanks(buildFormData({ orgName }));
    const afterSecond = await orgByName(orgName);
    expect(afterSecond).toHaveLength(1); // still one org
    expect(afterSecond[0].id).toBe(orgId); // same org reused

    const apps = await db
      .select()
      .from(sponsorApplications)
      .where(eq(sponsorApplications.orgId, orgId));
    expect(apps).toHaveLength(2); // a valid second lead

    const evs = await db
      .select()
      .from(events)
      .where(eq(events.orgId, orgId));
    expect(evs).toHaveLength(2);
    expect(evs.every((e) => e.orgId === orgId)).toBe(true);
  });

  it("generates unique event slugs for two same-name submissions", async () => {
    const orgName = newOrgName();

    await expectRedirectToThanks(buildFormData({ orgName }));
    await expectRedirectToThanks(buildFormData({ orgName }));

    const orgs = await orgByName(orgName);
    const evs = await db
      .select({ slug: events.slug })
      .from(events)
      .where(eq(events.orgId, orgs[0].id));
    expect(evs).toHaveLength(2);
    const slugs = evs.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(2); // unique
    for (const slug of slugs) {
      expect(slug.startsWith(`${slugify(orgName)}-`)).toBe(true);
    }
  });

  it("rejects an invalid payload with field errors and writes zero rows (no partial writes)", async () => {
    const orgName = newOrgName();
    const fd = buildFormData({
      orgName,
      overrides: { poc_phone: "not-a-phone" },
    });

    const state = await createSponsorApplication(initialSponsorFormState, fd);

    expect(state.ok).toBe(false);
    expect(state.fieldErrors).toBeDefined();
    expect(state.fieldErrors?.pocPhone).toBeDefined();
    expect(state.values?.orgName).toBe(orgName); // values echoed back

    // Validation fails before the transaction — nothing is written.
    expect(await orgByName(orgName)).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a failed spam check with a generic error and writes zero rows", async () => {
    const orgName = newOrgName();
    const fd = buildFormData({ orgName, challenge: null }); // empty challenge

    const state = await createSponsorApplication(initialSponsorFormState, fd);

    expect(state.ok).toBe(false);
    expect(state.formError).toMatch(/couldn't verify/i); // generic, not field-level
    expect(state.fieldErrors).toBeUndefined();

    expect(await orgByName(orgName)).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still commits and redirects when an email send rejects", async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error("smtp down"));

    const orgName = newOrgName();
    await expectRedirectToThanks(buildFormData({ orgName }));

    // Row committed despite the send failure...
    const orgs = await orgByName(orgName);
    expect(orgs).toHaveLength(1);
    const apps = await db
      .select()
      .from(sponsorApplications)
      .where(eq(sponsorApplications.orgId, orgs[0].id));
    expect(apps).toHaveLength(1);

    // ...both sends were attempted...
    expect(sendMock).toHaveBeenCalledTimes(2);

    // ...and the failure was audit-logged (does not block the redirect).
    const evs = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.orgId, orgs[0].id));
    const failAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, evs[0].id),
          eq(auditLog.action, "sponsor_application.email_failed"),
        ),
      );
    expect(failAudit).toHaveLength(1);
  });
});

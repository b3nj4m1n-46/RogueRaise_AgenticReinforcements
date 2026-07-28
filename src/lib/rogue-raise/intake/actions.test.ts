/**
 * Integration tests for the sponsor intake actions against a REAL local Postgres
 * (DATABASE_URL from .env). Mirrors the story-1/story-2 harness: "dotenv/config"
 * first, the email adapter + next/cache + next/headers mocked, the DB real.
 *
 * Blob storage uses the LOCAL provider pointed at a throwaway directory, so the
 * upload path is exercised end to end (bytes actually land on disk and are
 * actually deleted) without inventing a fake adapter that could drift from the
 * real one.
 */
import "dotenv/config";

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "rr-blob-test-"));
process.env.RR_LOCAL_BLOB_DIR = BLOB_DIR;
delete process.env.BLOB_READ_WRITE_TOKEN;

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module under test) ----------------------------

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

// revalidatePath throws outside a Next request/render store — no-op it here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "../db";
import {
  attachments,
  auditLog,
  criteria,
  dateOptions,
  eventIntakes,
  events,
  judges,
  magicLinkTokens,
  organizations,
  sponsorApplications,
  stakeholders,
  techSponsors,
} from "../db/schema";
import { generateMagicToken, MAGIC_LINK_TTL_MS } from "../sponsors/magic-link";
import {
  removeIntakeAttachment,
  saveIntake,
  uploadIntakeAttachment,
} from "./actions";
import { INTAKE_ATTACHMENT_KIND } from "./constants";
import { initialIntakeFormState } from "./form-state";
import { loadIntake } from "./queries";
import { emptyIntakeDraft, type IntakeDraft } from "./schema";

// --- Fixtures ---------------------------------------------------------------

const FRIDAY = "2026-08-14";
const OTHER_FRIDAY = "2026-08-21";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  orgId: string;
  applicationId: string;
  token: string;
}

async function createFixture(options: { status?: string; expired?: boolean } = {}) {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Intake Test Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail: `jamie-${suffix}@example.org`,
      pocPhone: "+15415551234",
      painPoints: "Shelter data lives in spreadsheets.",
      goalsNeeds: "One place to see capacity.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `intake-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: (options.status ?? "intake_pending") as "intake_pending",
    })
    .returning({ id: events.id });

  const { raw, hash } = generateMagicToken();
  await db.insert(magicLinkTokens).values({
    eventId: event.id,
    role: "sponsor_poc",
    subjectId: application.id,
    email: `jamie-${suffix}@example.org`,
    tokenHash: hash,
    expiresAt: new Date(
      Date.now() + (options.expired ? -1000 : MAGIC_LINK_TTL_MS),
    ),
  });

  return {
    eventId: event.id,
    orgId: org.id,
    applicationId: application.id,
    token: raw,
  } satisfies Fixture;
}

function draftWith(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return { ...emptyIntakeDraft(), ...overrides };
}

const completeDraft = draftWith({
  dateOptions: [{ date: FRIDAY, kickoffHour: 17 }],
  supplementaryInfo: "Five years of shelter intake spreadsheets.",
  stakeholderTechStack: "Postgres, a Django admin, and a lot of Excel.",
});

function saveForm(fixture: Fixture, draft: IntakeDraft): FormData {
  const formData = new FormData();
  formData.set("event_id", fixture.eventId);
  formData.set("token", fixture.token);
  formData.set("intake_json", JSON.stringify(draft));
  return formData;
}

function uploadForm(fixture: Fixture, file: File): FormData {
  const formData = new FormData();
  formData.set("event_id", fixture.eventId);
  formData.set("token", fixture.token);
  formData.set("file", file);
  return formData;
}

function pdfFile(name = "context.pdf"): File {
  return new File([PDF_BYTES], name, { type: "application/pdf" });
}

const save = (fixture: Fixture, draft: IntakeDraft) =>
  saveIntake(initialIntakeFormState, saveForm(fixture, draft));

async function eventStatus(eventId: string): Promise<string> {
  const [row] = await db
    .select({ status: events.status })
    .from(events)
    .where(eq(events.id, eventId));
  return row.status;
}

async function auditActions(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.eventId, eventId))
    .orderBy(auditLog.createdAt);
  return rows.map((r) => r.action);
}

// --- Cleanup ----------------------------------------------------------------

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
      // Children first, then events, then applications, then orgs.
      await db.delete(attachments).where(inArray(attachments.eventId, eventIds));
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(magicLinkTokens).where(inArray(magicLinkTokens.eventId, eventIds));
      await db.delete(judges).where(inArray(judges.eventId, eventIds));
      await db.delete(criteria).where(inArray(criteria.eventId, eventIds));
      await db.delete(techSponsors).where(inArray(techSponsors.eventId, eventIds));
      await db.delete(dateOptions).where(inArray(dateOptions.eventId, eventIds));
      await db.delete(eventIntakes).where(inArray(eventIntakes.eventId, eventIds));
      await db.delete(stakeholders).where(inArray(stakeholders.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
  rmSync(BLOB_DIR, { recursive: true, force: true });
});

// --- Tests ------------------------------------------------------------------

describe("saveIntake — drafts", () => {
  it("creates the intake row and every collection on first save", async () => {
    const fixture = await createFixture();
    const state = await save(
      fixture,
      draftWith({
        judges: [{ name: "Ada Lovelace", email: "ada@example.org", phone: "+15415551234" }],
        criteria: [{ label: "Impact", description: "Who it helps", weight: "40" }],
        techSponsors: [
          {
            name: "Acme AI",
            offering: "API credits",
            contactName: "Sam",
            contactEmail: "sam@acme.example",
            status: "contacted",
          },
        ],
        awardsBudget: { amount: "1500.00", note: "Split across two prizes" },
        stakeholderTechTags: ["postgres", "python"],
      }),
    );

    expect(state.status).toBe("saved");
    expect(state.complete).toBe(false);

    const loaded = await loadIntake(fixture.eventId);
    expect(loaded.draft.judges).toEqual([
      { name: "Ada Lovelace", email: "ada@example.org", phone: "+15415551234" },
    ]);
    expect(loaded.draft.criteria[0]).toMatchObject({ label: "Impact", weight: "40.000" });
    expect(loaded.draft.techSponsors[0].status).toBe("contacted");
    expect(loaded.draft.awardsBudget.amount).toBe("1500.00");
    expect(loaded.draft.stakeholderTechTags).toEqual(["postgres", "python"]);
    expect(loaded.completedAt).toBeNull();
    expect(await eventStatus(fixture.eventId)).toBe("intake_pending");
  });

  it("is resumable — a second save round-trips the previous values", async () => {
    const fixture = await createFixture();
    await save(fixture, draftWith({ supplementaryInfo: "First sitting." }));

    const first = await loadIntake(fixture.eventId);
    expect(first.draft.supplementaryInfo).toBe("First sitting.");

    await save(
      fixture,
      draftWith({ ...first.draft, stakeholderTechStack: "Second sitting." }),
    );
    const second = await loadIntake(fixture.eventId);
    expect(second.draft.supplementaryInfo).toBe("First sitting.");
    expect(second.draft.stakeholderTechStack).toBe("Second sitting.");
  });

  it("drops rows the user added but never filled in", async () => {
    const fixture = await createFixture();
    const state = await saveIntake(
      initialIntakeFormState,
      (() => {
        const formData = new FormData();
        formData.set("event_id", fixture.eventId);
        formData.set("token", fixture.token);
        formData.set(
          "intake_json",
          JSON.stringify({
            ...emptyIntakeDraft(),
            judges: [
              { name: "", email: "", phone: "" },
              { name: "Ada", email: "ada@example.org", phone: "" },
            ],
          }),
        );
        return formData;
      })(),
    );

    expect(state.status).toBe("saved");
    expect((await loadIntake(fixture.eventId)).draft.judges).toHaveLength(1);
  });

  it("rejects an invalid row by dot-path and writes nothing", async () => {
    const fixture = await createFixture();
    const state = await save(
      fixture,
      draftWith({ judges: [{ name: "Ada", email: "not-an-email" }] as IntakeDraft["judges"] }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.["judges.0.email"]?.[0]).toMatch(/valid email/);
    expect(await db.select().from(eventIntakes).where(eq(eventIntakes.eventId, fixture.eventId)))
      .toHaveLength(0);
  });

  it("refuses a weekend that isn't a Friday", async () => {
    const fixture = await createFixture();
    const state = await save(
      fixture,
      draftWith({ dateOptions: [{ date: "2026-08-15", kickoffHour: 17 }] }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.["dateOptions.0.date"]?.[0]).toMatch(/Friday/);
  });

  it("collapses a weekend offered twice into one option", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({
        dateOptions: [
          { date: FRIDAY, kickoffHour: 17 },
          { date: FRIDAY, kickoffHour: 17 },
        ],
      }),
    );
    expect((await loadIntake(fixture.eventId)).draft.dateOptions).toHaveLength(1);
  });

  it("keeps a confirmed weekend's confirmation across a re-save", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({
        dateOptions: [
          { date: FRIDAY, kickoffHour: 17 },
          { date: OTHER_FRIDAY, kickoffHour: 17 },
        ],
      }),
    );

    // Stand in for the (next story's) admin confirmation.
    const [first] = await db
      .select({ id: dateOptions.id })
      .from(dateOptions)
      .where(eq(dateOptions.eventId, fixture.eventId))
      .orderBy(dateOptions.fridayKickoffAt);
    await db
      .update(dateOptions)
      .set({ isConfirmed: true })
      .where(eq(dateOptions.id, first.id));

    await save(
      fixture,
      draftWith({
        dateOptions: [
          { date: FRIDAY, kickoffHour: 17 },
          { date: OTHER_FRIDAY, kickoffHour: 17 },
        ],
      }),
    );

    const rows = await db
      .select({ isConfirmed: dateOptions.isConfirmed })
      .from(dateOptions)
      .where(eq(dateOptions.eventId, fixture.eventId))
      .orderBy(dateOptions.fridayKickoffAt);
    expect(rows.map((r) => r.isConfirmed)).toEqual([true, false]);
  });
});

describe("saveIntake — completion", () => {
  it("advances the event and notifies the admin exactly once", async () => {
    const fixture = await createFixture();
    const state = await save(fixture, completeDraft);

    expect(state.complete).toBe(true);
    expect(state.justCompleted).toBe(true);
    expect(await eventStatus(fixture.eventId)).toBe("intake_complete");
    expect((await loadIntake(fixture.eventId)).completedAt).not.toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].subject).toMatch(/intake complete/i);

    const actions = await auditActions(fixture.eventId);
    expect(actions).toContain("event.intake_complete");
    expect(actions).toContain("event_intake.completed");
  });

  it("stays silent when a complete intake is saved again", async () => {
    const fixture = await createFixture();
    await save(fixture, completeDraft);
    sendMock.mockClear();
    const before = (await auditActions(fixture.eventId)).length;

    const state = await save(fixture, completeDraft);

    expect(state.complete).toBe(true);
    expect(state.justCompleted).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(await auditActions(fixture.eventId)).toHaveLength(before);
  });

  it("reverts to intake_pending when a vital field is emptied, and does not email", async () => {
    const fixture = await createFixture();
    await save(fixture, completeDraft);
    sendMock.mockClear();

    const state = await save(
      fixture,
      draftWith({ ...completeDraft, stakeholderTechStack: undefined }),
    );

    expect(state.complete).toBe(false);
    expect(await eventStatus(fixture.eventId)).toBe("intake_pending");
    expect((await loadIntake(fixture.eventId)).completedAt).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
    expect(await auditActions(fixture.eventId)).toContain("event_intake.reopened");
  });
});

describe("saveIntake — authorization", () => {
  it("refuses a token minted for a different event", async () => {
    const mine = await createFixture();
    const theirs = await createFixture();

    const formData = new FormData();
    formData.set("event_id", theirs.eventId);
    formData.set("token", mine.token); // valid token, wrong event
    formData.set("intake_json", JSON.stringify(completeDraft));

    const state = await saveIntake(initialIntakeFormState, formData);
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/doesn't open this Rogue Raise/);
    expect(await eventStatus(theirs.eventId)).toBe("intake_pending");
    expect(
      await db.select().from(eventIntakes).where(eq(eventIntakes.eventId, theirs.eventId)),
    ).toHaveLength(0);
  });

  it("refuses an expired token", async () => {
    const fixture = await createFixture({ expired: true });
    const state = await save(fixture, completeDraft);
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/expired/);
  });

  it("refuses a garbage token", async () => {
    const fixture = await createFixture();
    const state = await save({ ...fixture, token: "not-a-real-token" }, completeDraft);
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/isn't valid/);
  });

  it("refuses once the event has moved past the intake phase", async () => {
    const fixture = await createFixture({ status: "repo_generating" });
    const state = await save(fixture, completeDraft);
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/no longer open for edits/);
  });
});

describe("saveIntake — judges", () => {
  it("keeps a judge who has already completed their profile, and rolls the save back", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({ judges: [{ name: "Ada Lovelace", email: "ada@example.org" }] }),
    );
    await db
      .update(judges)
      .set({ backgroundCompletedAt: new Date() })
      .where(eq(judges.eventId, fixture.eventId));

    const state = await save(
      fixture,
      draftWith({ judges: [], supplementaryInfo: "This must not be saved either." }),
    );

    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/Ada Lovelace/);
    // The whole transaction rolled back — the judge AND the untouched fields.
    expect(await db.select().from(judges).where(eq(judges.eventId, fixture.eventId)))
      .toHaveLength(1);
    expect((await loadIntake(fixture.eventId)).draft.supplementaryInfo).toBeUndefined();
  });

  it("updates a judge in place when their email is unchanged", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({ judges: [{ name: "Ada Lovelace", email: "ada@example.org" }] }),
    );
    const [before] = await db
      .select({ id: judges.id })
      .from(judges)
      .where(eq(judges.eventId, fixture.eventId));

    await save(
      fixture,
      draftWith({
        judges: [{ name: "Dr. Ada Lovelace", email: "ada@example.org", phone: "+15415551234" }],
      }),
    );

    const after = await db
      .select({ id: judges.id, name: judges.name, phone: judges.phone })
      .from(judges)
      .where(eq(judges.eventId, fixture.eventId));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id); // same row, not delete+insert
    expect(after[0].name).toBe("Dr. Ada Lovelace");
    expect(after[0].phone).toBe("+15415551234");
  });
});

describe("attachments", () => {
  it("stores a file, satisfies supporting context on its own, and completes the intake", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({
        dateOptions: [{ date: FRIDAY, kickoffHour: 17 }],
        stakeholderTechStack: "Postgres and Excel.",
      }),
    );
    expect(await eventStatus(fixture.eventId)).toBe("intake_pending");
    sendMock.mockClear();

    const state = await uploadIntakeAttachment(initialIntakeFormState, uploadForm(fixture, pdfFile()));

    expect(state.status).toBe("saved");
    expect(state.notice).toMatch(/Added context\.pdf/);
    expect(state.complete).toBe(true);
    expect(await eventStatus(fixture.eventId)).toBe("intake_complete");
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.eventId, fixture.eventId));
    expect(row.kind).toBe(INTAKE_ATTACHMENT_KIND);
    expect(row.isPublic).toBe(false);
    expect(row.contentType).toBe("application/pdf");
    expect(row.sizeBytes).toBe(PDF_BYTES.length);
    // The bytes really landed on disk, under a key that hides the filename.
    const storedKey = row.blobUrl.replace(/^local:/, "");
    expect(storedKey).not.toContain("context");
    expect(existsSync(path.join(BLOB_DIR, storedKey))).toBe(true);
  });

  it("rejects a file whose bytes contradict its extension", async () => {
    const fixture = await createFixture();
    const fake = new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46])], "payload.pdf", {
      type: "application/pdf",
    });

    const state = await uploadIntakeAttachment(initialIntakeFormState, uploadForm(fixture, fake));

    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/doesn't look like a real \.pdf/);
    expect(await db.select().from(attachments).where(eq(attachments.eventId, fixture.eventId)))
      .toHaveLength(0);
  });

  it("removes a file, deletes its bytes, and reverts completion", async () => {
    const fixture = await createFixture();
    await save(
      fixture,
      draftWith({
        dateOptions: [{ date: FRIDAY, kickoffHour: 17 }],
        stakeholderTechStack: "Postgres and Excel.",
      }),
    );
    await uploadIntakeAttachment(initialIntakeFormState, uploadForm(fixture, pdfFile()));
    const [row] = await db
      .select({ id: attachments.id, blobUrl: attachments.blobUrl })
      .from(attachments)
      .where(eq(attachments.eventId, fixture.eventId));
    sendMock.mockClear();

    const formData = new FormData();
    formData.set("event_id", fixture.eventId);
    formData.set("token", fixture.token);
    formData.set("attachment_id", row.id);
    const state = await removeIntakeAttachment(initialIntakeFormState, formData);

    expect(state.status).toBe("saved");
    expect(state.complete).toBe(false);
    expect(await eventStatus(fixture.eventId)).toBe("intake_pending");
    expect(existsSync(path.join(BLOB_DIR, row.blobUrl.replace(/^local:/, "")))).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never lets one event's token delete another event's file", async () => {
    const mine = await createFixture();
    const theirs = await createFixture();
    await uploadIntakeAttachment(initialIntakeFormState, uploadForm(theirs, pdfFile()));
    const [victim] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.eventId, theirs.eventId));

    const formData = new FormData();
    formData.set("event_id", mine.eventId); // my event…
    formData.set("token", mine.token); // …my valid token…
    formData.set("attachment_id", victim.id); // …their file
    const state = await removeIntakeAttachment(initialIntakeFormState, formData);

    expect(state.status).toBe("error");
    expect(
      await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, victim.id), eq(attachments.eventId, theirs.eventId))),
    ).toHaveLength(1);
  });

  it("refuses an upload once the event has moved past the intake phase", async () => {
    const fixture = await createFixture({ status: "live" });
    const state = await uploadIntakeAttachment(initialIntakeFormState, uploadForm(fixture, pdfFile()));
    expect(state.status).toBe("error");
    expect(state.formError).toMatch(/no longer open for edits/);
  });
});

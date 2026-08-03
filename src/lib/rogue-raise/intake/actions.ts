"use server";

/**
 * Sponsor secondary-intake actions (PRD §5.2.2). Three `useActionState`-shaped
 * actions — `saveIntake`, `uploadIntakeAttachment`, `removeIntakeAttachment` —
 * all sharing the same guarantees:
 *
 *   - **Every** action re-verifies the magic-link token against the `eventId` it
 *     was given. The page render is never treated as authorization; a token for
 *     Event A can never write Event B.
 *   - Editing is refused unless `Event.status` is `intake_pending` or
 *     `intake_complete`, re-checked under a `FOR UPDATE` lock inside the
 *     transaction (not just at the door).
 *   - All writes for one action happen in ONE transaction; a throw rolls back
 *     everything, including the completion transition.
 *   - Completion is recomputed from the COMMITTED rows (never from the submitted
 *     payload) by the same pure function the progress indicator uses.
 *   - The admin "intake complete" email sends only AFTER commit, and only on the
 *     save that actually flipped the event — re-saving a complete intake is silent.
 *   - Audit rows carry ids only: no PII, and never the raw token.
 *
 * Autosave shapes the error handling: a failed save must never lose typed data,
 * so failures return a state the client renders alongside its own (retained)
 * values rather than redirecting or clearing anything.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "../db";
import {
  attachments,
  auditLog,
  criteria,
  dateOptions,
  eventIntakes,
  events,
  judges,
  judgeScores,
  organizations,
  techSponsors,
} from "../db/schema";
import { getBlobAdapter } from "../integrations/blob";
import { getEmailAdapter } from "../integrations/email";
import { canEditIntake, redeemIntakeToken } from "./access";
import { ACTOR_SPONSOR_POC, INTAKE_ATTACHMENT_KIND } from "./constants";
import { evaluateCompleteness, type CompletenessFacts } from "./completeness";
import { buildIntakeCompleteAdminEmail } from "./emails";
import {
  intakeAccessMessage,
  type IntakeFieldErrors,
  type IntakeFormState,
} from "./form-state";
import { buildFridayKickoff, formatWeekendLabel } from "./schedule";
import {
  dropBlankRows,
  intakeDraftSchema,
  type IntakeDraft,
} from "./schema";
import {
  buildAttachmentKey,
  safeDisplayFilename,
  scanUpload,
  validateUpload,
} from "./uploads";

// --- Small helpers ---------------------------------------------------------

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function nextVersion(prev: IntakeFormState): number {
  return (prev.version ?? 0) + 1;
}

function fail(
  prev: IntakeFormState,
  formError: string,
  fieldErrors?: IntakeFieldErrors,
): IntakeFormState {
  return {
    ...prev,
    status: "error",
    formError,
    fieldErrors,
    notice: undefined,
    justCompleted: false,
    version: nextVersion(prev),
  };
}

/**
 * Thrown inside the save transaction to roll it back with a reason we can put in
 * front of the user. Rolling back is the point: a save that can't remove a judge
 * must not half-apply the rest of the form.
 */
class JudgesLockedError extends Error {
  constructor(readonly names: string[]) {
    super("judges_locked");
    this.name = "JudgesLockedError";
  }
}

/** Parse the hidden JSON payload defensively; a malformed body is never a throw. */
function parseDraftJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fieldErrorsFromZod(
  issues: { path: PropertyKey[]; message: string }[],
): { fieldErrors: IntakeFieldErrors; formErrors: string[] } {
  const fieldErrors: IntakeFieldErrors = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message);
      continue;
    }
    const key = issue.path.map((p) => String(p)).join(".");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors, formErrors };
}

/**
 * Normalize the client payload: drop rows the user added but never filled in,
 * and coerce the few numeric/array fields JSON can send as strings.
 */
function normalizeDraftInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;
  const rows = (key: string): Record<string, unknown>[] =>
    Array.isArray(input[key])
      ? dropBlankRows(input[key] as Record<string, unknown>[])
      : [];

  return {
    judges: rows("judges"),
    criteria: rows("criteria"),
    dateOptions: rows("dateOptions").map((o) => ({
      ...o,
      kickoffHour: Number(o.kickoffHour),
    })),
    techSponsors: rows("techSponsors"),
    awardsBudget:
      input.awardsBudget && typeof input.awardsBudget === "object"
        ? input.awardsBudget
        : {},
    supplementaryInfo: input.supplementaryInfo,
    stakeholderTechStack: input.stakeholderTechStack,
    stakeholderTechTags: Array.isArray(input.stakeholderTechTags)
      ? input.stakeholderTechTags
      : [],
  };
}

// --- Shared authorization --------------------------------------------------

type Authorized =
  | { ok: true; eventId: string; tokenId: string }
  | { ok: false; message: string };

/**
 * The single door. Re-runs full token redemption for the URL's event and checks
 * the phase gate — called at the top of every action, never cached.
 */
async function authorize(formData: FormData): Promise<Authorized> {
  const eventId = str(formData, "event_id");
  const rawToken = str(formData, "token");

  const access = await redeemIntakeToken({ eventId, rawToken });
  if (!access.ok) {
    return { ok: false, message: intakeAccessMessage(access.reason) };
  }
  if (!canEditIntake(access.access.event.status)) {
    return {
      ok: false,
      message:
        "This intake is no longer open for edits. Reply to our email and we'll pick it up from there.",
    };
  }
  return { ok: true, eventId: access.access.event.id, tokenId: access.access.tokenId };
}

// --- Completion (recomputed from committed rows) ---------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countRows(
  tx: Tx,
  table: typeof dateOptions | typeof criteria | typeof techSponsors | typeof judges,
  eventId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(table)
    .where(eq(table.eventId, eventId));
  return Number(row?.n ?? 0);
}

async function countAttachments(tx: Tx, eventId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(attachments)
    .where(
      and(
        eq(attachments.eventId, eventId),
        eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
      ),
    );
  return Number(row?.n ?? 0);
}

async function readFacts(tx: Tx, eventId: string): Promise<CompletenessFacts> {
  const [intake] = await tx
    .select({
      supplementaryInfo: eventIntakes.supplementaryInfo,
      stakeholderTechStack: eventIntakes.stakeholderTechStack,
      awardsBudgetAmount: eventIntakes.awardsBudgetAmount,
      awardsBudgetNote: eventIntakes.awardsBudgetNote,
    })
    .from(eventIntakes)
    .where(eq(eventIntakes.eventId, eventId))
    .limit(1);

  return {
    dateOptionCount: await countRows(tx, dateOptions, eventId),
    supplementaryInfo: intake?.supplementaryInfo ?? null,
    attachmentCount: await countAttachments(tx, eventId),
    stakeholderTechStack: intake?.stakeholderTechStack ?? null,
    judgeCount: await countRows(tx, judges, eventId),
    criteriaCount: await countRows(tx, criteria, eventId),
    techSponsorCount: await countRows(tx, techSponsors, eventId),
    awardsBudgetAmount: intake?.awardsBudgetAmount ?? null,
    awardsBudgetNote: intake?.awardsBudgetNote ?? null,
  };
}

interface CompletionOutcome {
  complete: boolean;
  /** True only when THIS transaction flipped the event to `intake_complete`. */
  justCompleted: boolean;
  facts: CompletenessFacts;
}

/**
 * Recompute completion from committed rows and apply the resulting transition.
 * Idempotent: an intake that was already complete and still is writes nothing,
 * which is what keeps the admin notification a once-only event.
 */
async function syncCompletion(
  tx: Tx,
  eventId: string,
  eventStatus: string,
  tokenId: string,
  now: Date,
): Promise<CompletionOutcome> {
  const facts = await readFacts(tx, eventId);
  const result = evaluateCompleteness(facts);

  const [intake] = await tx
    .select({ id: eventIntakes.id, completedAt: eventIntakes.completedAt })
    .from(eventIntakes)
    .where(eq(eventIntakes.eventId, eventId))
    .limit(1);
  const wasComplete = Boolean(intake?.completedAt);

  // Completion implies an intake row exists (stakeholder_tech_stack lives on
  // it), so this is unreachable — but without the guard a missing row would
  // leave `completed_at` unset and re-fire the admin notification on every
  // subsequent save.
  if (result.complete && !intake) {
    return { complete: false, justCompleted: false, facts };
  }

  if (result.complete === wasComplete) {
    return { complete: result.complete, justCompleted: false, facts };
  }

  const metadata = { eventId, tokenId };

  if (result.complete) {
    await tx
      .update(eventIntakes)
      .set({ completedAt: now, updatedAt: now })
      .where(eq(eventIntakes.eventId, eventId));
    if (eventStatus === "intake_pending") {
      await tx
        .update(events)
        .set({ status: "intake_complete", updatedAt: now })
        .where(eq(events.id, eventId));
      await tx.insert(auditLog).values({
        eventId,
        actor: ACTOR_SPONSOR_POC,
        action: "event.intake_complete",
        entity: "event",
        fromValue: eventStatus,
        toValue: "intake_complete",
        metadata,
      });
    }
    await tx.insert(auditLog).values({
      eventId,
      actor: ACTOR_SPONSOR_POC,
      action: "event_intake.completed",
      entity: "event_intake",
      fromValue: "incomplete",
      toValue: "complete",
      metadata,
    });
    return { complete: true, justCompleted: true, facts };
  }

  // Reverted: a vital field was emptied or its last supporting file removed.
  await tx
    .update(eventIntakes)
    .set({ completedAt: null, updatedAt: now })
    .where(eq(eventIntakes.eventId, eventId));
  if (eventStatus === "intake_complete") {
    await tx
      .update(events)
      .set({ status: "intake_pending", updatedAt: now })
      .where(eq(events.id, eventId));
    await tx.insert(auditLog).values({
      eventId,
      actor: ACTOR_SPONSOR_POC,
      action: "event.intake_pending",
      entity: "event",
      fromValue: eventStatus,
      toValue: "intake_pending",
      metadata,
    });
  }
  await tx.insert(auditLog).values({
    eventId,
    actor: ACTOR_SPONSOR_POC,
    action: "event_intake.reopened",
    entity: "event_intake",
    fromValue: "complete",
    toValue: "incomplete",
    metadata,
  });
  return { complete: false, justCompleted: false, facts };
}

/** Locks the event row and re-checks the phase gate INSIDE the transaction. */
async function lockEditableEvent(tx: Tx, eventId: string) {
  const [event] = await tx
    .select({
      id: events.id,
      status: events.status,
      title: events.title,
      orgId: events.orgId,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .for("update")
    .limit(1);
  if (!event || !canEditIntake(event.status)) return null;
  return event;
}

// --- Post-commit admin notification ----------------------------------------

async function notifyAdminIntakeComplete(
  eventId: string,
  facts: CompletenessFacts,
): Promise<void> {
  const [event] = await db
    .select({
      title: events.title,
      orgName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return;

  const weekends = await db
    .select({ fridayKickoffAt: dateOptions.fridayKickoffAt })
    .from(dateOptions)
    .where(eq(dateOptions.eventId, eventId))
    .orderBy(dateOptions.fridayKickoffAt);

  const message = buildIntakeCompleteAdminEmail({
    orgName: event.orgName,
    eventTitle: event.title,
    eventId,
    weekendLabels: weekends.map((w) => formatWeekendLabel(w.fridayKickoffAt)),
    judgeCount: facts.judgeCount,
    criteriaCount: facts.criteriaCount,
    attachmentCount: facts.attachmentCount,
  });

  const [send] = await Promise.allSettled([getEmailAdapter().send(message)]);
  if (send.status === "rejected") {
    try {
      await db.insert(auditLog).values({
        eventId,
        actor: "system",
        action: "event_intake.email_failed",
        entity: "event_intake",
        metadata: { eventId },
      });
    } catch (err) {
      console.error("[intake] failed to audit email failure", err);
    }
  }
}

// --- saveIntake ------------------------------------------------------------

type SaveOutcome =
  | { kind: "locked" }
  | { kind: "ok"; completion: CompletionOutcome };

/**
 * Replace the repeatable collections for an event.
 *
 * Dates, criteria and technical sponsors are replaced wholesale — safe because
 * the phase gate means nothing downstream references them yet. Judges are
 * RECONCILED by email instead: a judge may already have completed their
 * background form (PRD §5.3.4) while the intake is still editable, and that work
 * must survive an autosave. A judge with dependent data cannot be removed here;
 * the save is refused with a message naming them, rather than silently keeping
 * or silently destroying the row.
 */
async function replaceCollections(
  tx: Tx,
  eventId: string,
  draft: IntakeDraft,
  now: Date,
): Promise<void> {
  // --- Date options (preserve a confirmed weekend's flag) ---
  const existingDates = await tx
    .select({
      fridayKickoffAt: dateOptions.fridayKickoffAt,
      isConfirmed: dateOptions.isConfirmed,
    })
    .from(dateOptions)
    .where(eq(dateOptions.eventId, eventId));
  const confirmedInstants = new Set(
    existingDates.filter((d) => d.isConfirmed).map((d) => d.fridayKickoffAt.getTime()),
  );

  await tx.delete(dateOptions).where(eq(dateOptions.eventId, eventId));
  const seenInstants = new Set<number>();
  const dateRows = draft.dateOptions
    .map((option) => buildFridayKickoff(option.date, option.kickoffHour))
    .filter((instant) => {
      // The same weekend offered twice is one weekend.
      if (seenInstants.has(instant.getTime())) return false;
      seenInstants.add(instant.getTime());
      return true;
    })
    .map((instant) => ({
      eventId,
      fridayKickoffAt: instant,
      isConfirmed: confirmedInstants.has(instant.getTime()),
    }));
  if (dateRows.length) await tx.insert(dateOptions).values(dateRows);

  // --- Criteria ---
  await tx.delete(criteria).where(eq(criteria.eventId, eventId));
  if (draft.criteria.length) {
    await tx.insert(criteria).values(
      draft.criteria.map((c, index) => ({
        eventId,
        label: c.label,
        description: c.description ?? null,
        weight: c.weight ?? null,
        sortOrder: index,
      })),
    );
  }

  // --- Technical sponsors ---
  await tx.delete(techSponsors).where(eq(techSponsors.eventId, eventId));
  if (draft.techSponsors.length) {
    await tx.insert(techSponsors).values(
      draft.techSponsors.map((s) => ({
        eventId,
        name: s.name,
        offering: s.offering ?? null,
        contactName: s.contactName ?? null,
        contactEmail: s.contactEmail ?? null,
        status: s.status,
      })),
    );
  }

  // --- Judges (reconciled by email) ---
  const existingJudges = await tx
    .select({
      id: judges.id,
      name: judges.name,
      email: judges.email,
      backgroundCompletedAt: judges.backgroundCompletedAt,
    })
    .from(judges)
    .where(eq(judges.eventId, eventId));

  const byEmail = new Map(existingJudges.map((j) => [j.email.toLowerCase(), j]));
  const submittedEmails = new Set(draft.judges.map((j) => j.email.toLowerCase()));

  const removable: string[] = [];
  const judgeLocked: string[] = [];
  for (const existing of existingJudges) {
    if (submittedEmails.has(existing.email.toLowerCase())) continue;
    if (existing.backgroundCompletedAt) {
      judgeLocked.push(existing.name);
      continue;
    }
    removable.push(existing.id);
  }

  if (removable.length) {
    const scored = await tx
      .select({ judgeId: judgeScores.judgeId })
      .from(judgeScores)
      .where(inArray(judgeScores.judgeId, removable));
    const scoredIds = new Set(scored.map((s) => s.judgeId));
    const safeToDelete = removable.filter((id) => !scoredIds.has(id));
    for (const id of removable) {
      if (!scoredIds.has(id)) continue;
      const judge = existingJudges.find((j) => j.id === id);
      if (judge) judgeLocked.push(judge.name);
    }
    if (safeToDelete.length) {
      await tx.delete(judges).where(inArray(judges.id, safeToDelete));
    }
  }

  // Refuse the whole save rather than half-apply it — the throw rolls the
  // transaction back, so nothing above this line survives either.
  if (judgeLocked.length) throw new JudgesLockedError(judgeLocked);

  for (const judge of draft.judges) {
    const existing = byEmail.get(judge.email.toLowerCase());
    if (existing) {
      await tx
        .update(judges)
        .set({ name: judge.name, phone: judge.phone ?? null, updatedAt: now })
        .where(eq(judges.id, existing.id));
    } else {
      await tx.insert(judges).values({
        eventId,
        name: judge.name,
        email: judge.email,
        phone: judge.phone ?? null,
      });
    }
  }
}

export async function saveIntake(
  prevState: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const auth = await authorize(formData);
  if (!auth.ok) return fail(prevState, auth.message);

  const normalized = normalizeDraftInput(parseDraftJson(str(formData, "intake_json")));
  if (normalized === null) {
    return fail(prevState, "We couldn't read that form. Please refresh and try again.");
  }

  const parsed = intakeDraftSchema.safeParse(normalized);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = fieldErrorsFromZod(parsed.error.issues);
    return fail(
      prevState,
      formErrors[0] ?? "Some entries need a small fix before we can save.",
      fieldErrors,
    );
  }
  const draft = parsed.data;
  const now = new Date();

  let outcome: SaveOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const event = await lockEditableEvent(tx, auth.eventId);
      if (!event) return { kind: "locked" as const };

      const [existingIntake] = await tx
        .select({ id: eventIntakes.id })
        .from(eventIntakes)
        .where(eq(eventIntakes.eventId, auth.eventId))
        .limit(1);

      const intakeValues = {
        awardsBudgetAmount: draft.awardsBudget.amount ?? null,
        awardsBudgetNote: draft.awardsBudget.note ?? null,
        supplementaryInfo: draft.supplementaryInfo ?? null,
        stakeholderTechStack: draft.stakeholderTechStack ?? null,
        stakeholderTechTags: draft.stakeholderTechTags,
        updatedAt: now,
      };

      if (existingIntake) {
        await tx
          .update(eventIntakes)
          .set(intakeValues)
          .where(eq(eventIntakes.id, existingIntake.id));
      } else {
        await tx
          .insert(eventIntakes)
          .values({ eventId: auth.eventId, ...intakeValues });
      }

      await replaceCollections(tx, auth.eventId, draft, now);

      const completion = await syncCompletion(
        tx,
        auth.eventId,
        event.status,
        auth.tokenId,
        now,
      );
      return { kind: "ok" as const, completion };
    });
  } catch (err) {
    if (err instanceof JudgesLockedError) {
      return fail(
        prevState,
        `${err.names.join(", ")} has already filled in a judge profile, so we couldn't remove them. Everything else is unchanged — put them back, or contact us and we'll sort it out.`,
      );
    }
    console.error("[intake] saveIntake transaction failed", err);
    return fail(
      prevState,
      "Something went wrong saving your intake. Your answers are still here — please try again.",
    );
  }

  if (outcome.kind === "locked") {
    return fail(
      prevState,
      "This intake is no longer open for edits. Reply to our email and we'll pick it up from there.",
    );
  }
  if (outcome.completion.justCompleted) {
    await notifyAdminIntakeComplete(auth.eventId, outcome.completion.facts);
  }

  return {
    status: "saved",
    savedAt: now.toISOString(),
    complete: outcome.completion.complete,
    justCompleted: outcome.completion.justCompleted,
    version: nextVersion(prevState),
  };
}

// --- Attachments -----------------------------------------------------------

export async function uploadIntakeAttachment(
  prevState: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const auth = await authorize(formData);
  if (!auth.ok) return fail(prevState, auth.message);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail(prevState, "Choose a file to upload.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const existingCount = await db
    .select({ n: count() })
    .from(attachments)
    .where(
      and(
        eq(attachments.eventId, auth.eventId),
        eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
      ),
    )
    .then((rows) => Number(rows[0]?.n ?? 0));

  const validation = validateUpload({
    filename: file.name,
    declaredContentType: file.type,
    size: file.size,
    bytes,
    existingCount,
  });
  if (!validation.ok) {
    return fail(prevState, validation.message ?? "We couldn't accept that file.");
  }

  const scan = await scanUpload(bytes);
  if (!scan.clean) {
    return fail(prevState, "That file didn't pass our safety check.");
  }

  const filename = safeDisplayFilename(file.name);
  const key = buildAttachmentKey(auth.eventId, validation.extension!);

  let ref: string;
  try {
    const put = await getBlobAdapter().put({
      key,
      body: Buffer.from(bytes),
      contentType: validation.contentType,
      access: "private",
    });
    ref = put.ref;
  } catch (err) {
    console.error("[intake] blob put failed", err);
    return fail(prevState, "We couldn't store that file. Please try again.");
  }

  const now = new Date();
  let completion: CompletionOutcome | null = null;
  try {
    completion = await db.transaction(async (tx) => {
      const event = await lockEditableEvent(tx, auth.eventId);
      if (!event) return null;

      await tx.insert(attachments).values({
        eventId: auth.eventId,
        kind: INTAKE_ATTACHMENT_KIND,
        blobUrl: ref,
        filename,
        contentType: validation.contentType,
        sizeBytes: bytes.length,
        isPublic: false,
      });

      return syncCompletion(tx, auth.eventId, event.status, auth.tokenId, now);
    });
  } catch (err) {
    console.error("[intake] attachment insert failed", err);
    completion = null;
  }

  if (!completion) {
    // Never leave an orphan blob behind when the row didn't land.
    await getBlobAdapter()
      .del(ref)
      .catch((err) => console.error("[intake] orphan blob cleanup failed", err));
    return fail(prevState, "We couldn't attach that file. Please try again.");
  }

  if (completion.justCompleted) {
    await notifyAdminIntakeComplete(auth.eventId, completion.facts);
  }

  revalidatePath(`/sponsor/intake/${auth.eventId}`);
  return {
    status: "saved",
    savedAt: now.toISOString(),
    notice: `Added ${filename}.`,
    complete: completion.complete,
    justCompleted: completion.justCompleted,
    version: nextVersion(prevState),
  };
}

export async function removeIntakeAttachment(
  prevState: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const auth = await authorize(formData);
  if (!auth.ok) return fail(prevState, auth.message);

  const attachmentId = str(formData, "attachment_id");
  if (!z.uuid().safeParse(attachmentId).success) {
    return fail(prevState, "We couldn't find that file.");
  }

  const now = new Date();
  let result:
    | { removed: true; ref: string; filename: string; completion: CompletionOutcome }
    | { removed: false }
    | null = null;

  try {
    result = await db.transaction(async (tx) => {
      const event = await lockEditableEvent(tx, auth.eventId);
      if (!event) return { removed: false as const };

      // Scoped by event id as well as attachment id — a valid token for this
      // event can never delete another event's file.
      const [row] = await tx
        .select({
          id: attachments.id,
          blobUrl: attachments.blobUrl,
          filename: attachments.filename,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, attachmentId),
            eq(attachments.eventId, auth.eventId),
            eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
          ),
        )
        .limit(1);
      if (!row) return { removed: false as const };

      await tx.delete(attachments).where(eq(attachments.id, row.id));
      const completion = await syncCompletion(
        tx,
        auth.eventId,
        event.status,
        auth.tokenId,
        now,
      );
      return {
        removed: true as const,
        ref: row.blobUrl,
        filename: row.filename ?? "that file",
        completion,
      };
    });
  } catch (err) {
    console.error("[intake] removeIntakeAttachment transaction failed", err);
    return fail(prevState, "We couldn't remove that file. Please try again.");
  }

  if (!result || !result.removed) {
    return fail(prevState, "We couldn't find that file.");
  }

  // Blob deletion AFTER commit: a storage hiccup must not resurrect the row.
  await getBlobAdapter()
    .del(result.ref)
    .catch((err) => console.error("[intake] blob delete failed", err));

  revalidatePath(`/sponsor/intake/${auth.eventId}`);
  return {
    status: "saved",
    savedAt: now.toISOString(),
    notice: `Removed ${result.filename}.`,
    complete: result.completion.complete,
    justCompleted: false,
    version: nextVersion(prevState),
  };
}

"use server";

/**
 * Award categories and winners (PRD §7.3).
 *
 * The load-bearing rule here is one line of the PRD: *"Ties are surfaced (not
 * silently broken)."* Nothing in this module picks a winner. `loadResults`
 * reports tie groups; a person chooses, and the choice is written with an audit
 * row naming who chose. An award may also be created with no winner yet — that
 * is the normal state between the last pitch and the announcement.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, awardCategories, criteria, submissions } from "../db/schema";
import { adminActor, adminOrError } from "../admin/guard";

export interface AwardResult {
  ok: boolean;
  error?: string;
}

export async function createAwardCategory(
  eventId: string,
  input: { label: string; description?: string; criterionId?: string | null },
): Promise<AwardResult> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const label = input.label.trim();
  if (label.length < 2) {
    return { ok: false, error: "Give the award a name — at least a couple of characters." };
  }
  if (label.length > 120) {
    return { ok: false, error: "That award name is too long for a slide. Keep it under 120 characters." };
  }

  // A criterion from another event would silently mis-rank the award.
  if (input.criterionId) {
    const [criterion] = await db
      .select({ id: criteria.id, eventId: criteria.eventId })
      .from(criteria)
      .where(eq(criteria.id, input.criterionId))
      .limit(1);
    if (!criterion || criterion.eventId !== eventId) {
      return { ok: false, error: "That judging criterion isn't part of this event." };
    }
  }

  const [created] = await db
    .insert(awardCategories)
    .values({
      eventId,
      label,
      description: input.description?.trim() || null,
      criterionId: input.criterionId || null,
    })
    .returning({ id: awardCategories.id });

  await db.insert(auditLog).values({
    eventId,
    actor: adminActor(guard.admin),
    action: "award.created",
    entity: "award_category",
    toValue: label,
    metadata: { awardId: created.id, criterionId: input.criterionId ?? null },
  });

  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true };
}

/**
 * Records who won an award. Passing `null` clears it — an admin who assigns the
 * wrong team ten seconds before the announcement needs to be able to take it
 * back, so this is not one-way.
 */
export async function setAwardWinner(
  eventId: string,
  awardId: string,
  submissionId: string | null,
): Promise<AwardResult> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const [award] = await db
    .select()
    .from(awardCategories)
    .where(eq(awardCategories.id, awardId))
    .limit(1);
  if (!award || award.eventId !== eventId) {
    return { ok: false, error: "We couldn't find that award." };
  }
  if (award.announcedAt) {
    return {
      ok: false,
      error:
        "This award has already been announced. Reopen it first if the announcement was wrong.",
    };
  }

  if (submissionId) {
    const [submission] = await db
      .select({ id: submissions.id, eventId: submissions.eventId })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!submission || submission.eventId !== eventId) {
      return { ok: false, error: "That project isn't part of this event." };
    }
  }

  await db
    .update(awardCategories)
    .set({ winningSubmissionId: submissionId, updatedAt: new Date() })
    .where(eq(awardCategories.id, awardId));

  await db.insert(auditLog).values({
    eventId,
    actor: adminActor(guard.admin),
    action: submissionId ? "award.winner_set" : "award.winner_cleared",
    entity: "award_category",
    fromValue: award.winningSubmissionId,
    toValue: submissionId,
    // The tie (if any) that a human resolved to get here is in loadResults, and
    // this row is what ties the decision to a person and a time.
    metadata: { awardId, submissionId },
  });

  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true };
}

/** Marks an award announced — the point after which the winner is public. */
export async function announceAward(
  eventId: string,
  awardId: string,
): Promise<AwardResult> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const [award] = await db
    .select()
    .from(awardCategories)
    .where(eq(awardCategories.id, awardId))
    .limit(1);
  if (!award || award.eventId !== eventId) {
    return { ok: false, error: "We couldn't find that award." };
  }
  if (!award.winningSubmissionId) {
    return { ok: false, error: "Pick a winner before announcing this award." };
  }
  if (award.announcedAt) return { ok: true };

  await db
    .update(awardCategories)
    .set({ announcedAt: new Date(), updatedAt: new Date() })
    .where(eq(awardCategories.id, awardId));

  await db.insert(auditLog).values({
    eventId,
    actor: adminActor(guard.admin),
    action: "award.announced",
    entity: "award_category",
    toValue: award.winningSubmissionId,
    metadata: { awardId },
  });

  // Only the admin's own results view is revalidated. Announcing is also what
  // makes an award appear in the stakeholder portal (`portal/queries.ts` filters
  // on `announcedAt`), but revalidating `/portal/${eventId}` from here would do
  // nothing: the portal is `force-dynamic`, so it re-renders on every request
  // anyway, and the Router Cache this would clear belongs to the admin's
  // session, not the stakeholder's.
  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true };
}

/** Undoes an announcement, for the "wrong slide" moment. */
export async function reopenAward(
  eventId: string,
  awardId: string,
): Promise<AwardResult> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const [award] = await db
    .select()
    .from(awardCategories)
    .where(eq(awardCategories.id, awardId))
    .limit(1);
  if (!award || award.eventId !== eventId) {
    return { ok: false, error: "We couldn't find that award." };
  }

  await db
    .update(awardCategories)
    .set({ announcedAt: null, updatedAt: new Date() })
    .where(eq(awardCategories.id, awardId));

  await db.insert(auditLog).values({
    eventId,
    actor: adminActor(guard.admin),
    action: "award.reopened",
    entity: "award_category",
    metadata: { awardId },
  });

  // See `announceAward` for why the portal is not revalidated here.
  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true };
}

export async function deleteAwardCategory(
  eventId: string,
  awardId: string,
): Promise<AwardResult> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const [award] = await db
    .select()
    .from(awardCategories)
    .where(eq(awardCategories.id, awardId))
    .limit(1);
  if (!award || award.eventId !== eventId) {
    return { ok: false, error: "We couldn't find that award." };
  }
  if (award.announcedAt) {
    return {
      ok: false,
      error: "This award has been announced. Reopen it first if you need to remove it.",
    };
  }

  await db.delete(awardCategories).where(eq(awardCategories.id, awardId));
  await db.insert(auditLog).values({
    eventId,
    actor: adminActor(guard.admin),
    action: "award.deleted",
    entity: "award_category",
    fromValue: award.label,
    metadata: { awardId },
  });

  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true };
}

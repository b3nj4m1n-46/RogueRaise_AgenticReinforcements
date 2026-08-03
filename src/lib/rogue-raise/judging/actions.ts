"use server";

/**
 * Judge scorecard writes (PRD §7.2).
 *
 * A scorecard is saved per (submission, judge) — the unique constraint on
 * `judge_scores` makes that a real invariant rather than a convention. Two
 * behaviours matter more than the CRUD:
 *
 *   - **Draft vs final is the judge's call, and final is not a trapdoor.** A
 *     judge who submits and then hears something in the pitch that changes their
 *     mind can re-submit while the event is still `judging`. Once an admin moves
 *     the event past judging, the window closes for everyone at once.
 *   - **Partial scores save.** Judges score between pitches, on a phone, with
 *     someone talking to them. Refusing to keep three of five scores because the
 *     card isn't finished would lose real work; only the FINAL submit requires a
 *     complete card.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, criteria, events, judgeScores, submissions } from "../db/schema";
import { redeemJudgeToken } from "../judges/access";
import { judgeAccessMessage } from "../judges/access";
import { isJudgingOpen } from "./queries";
import { computeFinalScore, isComplete, isValidScore, MAX_SCORE, MIN_SCORE } from "./scoring";
import type { ScoreMap } from "./scoring";
import type { ScorecardState } from "./form-state";
import { adminActor, adminOrError } from "../admin/guard";

const MAX_NOTES = 4000;

export async function saveScorecard(
  _prev: ScorecardState,
  formData: FormData,
): Promise<ScorecardState> {
  const eventId = String(formData.get("event_id") ?? "");
  const token = String(formData.get("token") ?? "");
  const submissionId = String(formData.get("submission_id") ?? "");
  const intent = formData.get("intent") === "final" ? "final" : "draft";
  const version = Number(formData.get("version") ?? 0) + 1;
  const fail = (formError: string): ScorecardState => ({
    ok: false,
    submissionId,
    formError,
    version,
  });

  const access = await redeemJudgeToken({ rawToken: token, eventId });
  if (!access.ok) return fail(judgeAccessMessage(access.reason));
  const { judge, event } = access.access;

  if (!isJudgingOpen(event.status)) {
    return fail(
      "Scoring is closed for this event. If that's a surprise, find an organizer — don't re-enter your scores anywhere else.",
    );
  }

  const [submission] = await db
    .select({ id: submissions.id, eventId: submissions.eventId })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  // A submission from another event is indistinguishable from one that's gone.
  if (!submission || submission.eventId !== eventId) {
    return fail("We couldn't find that project.");
  }

  const criteriaRows = await db
    .select({ id: criteria.id, label: criteria.label, weight: criteria.weight })
    .from(criteria)
    .where(eq(criteria.eventId, eventId))
    .orderBy(criteria.sortOrder);
  if (criteriaRows.length === 0) {
    return fail(
      "This event has no judging criteria yet, so there's nothing to score against. Tell an organizer.",
    );
  }

  const scores: ScoreMap = {};
  const fieldErrors: Record<string, string> = {};
  for (const criterion of criteriaRows) {
    const raw = formData.get(`score_${criterion.id}`);
    if (raw === null || raw === "") continue; // Unscored — allowed in a draft.
    const value = Number(raw);
    if (!isValidScore(value)) {
      fieldErrors[criterion.id] = `Pick a score from ${MIN_SCORE} to ${MAX_SCORE}.`;
      continue;
    }
    scores[criterion.id] = value;
  }

  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > MAX_NOTES) {
    fieldErrors.notes = `Please keep notes under ${MAX_NOTES} characters.`;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, submissionId, fieldErrors, version };
  }

  // An incomplete card can't be FINAL, but the scores already entered are still
  // real work — they get written as a draft and the judge is told what's left.
  // Refusing the whole write here would throw away scoring done between pitches.
  const complete = isComplete(criteriaRows, scores);
  const incompleteFinal = intent === "final" && !complete;
  const isDraft = intent !== "final" || incompleteFinal;
  const finalScore = computeFinalScore(criteriaRows, scores);
  const now = new Date();

  await db
    .insert(judgeScores)
    .values({
      submissionId,
      judgeId: judge.id,
      scores,
      notes: notes || null,
      finalScore: finalScore === null ? null : String(finalScore),
      isDraft,
      submittedAt: isDraft ? null : now,
    })
    .onConflictDoUpdate({
      target: [judgeScores.submissionId, judgeScores.judgeId],
      set: {
        scores,
        notes: notes || null,
        finalScore: finalScore === null ? null : String(finalScore),
        isDraft,
        submittedAt: isDraft ? null : now,
        updatedAt: now,
      },
    });

  await db.insert(auditLog).values({
    eventId,
    actor: `judge:${judge.id}`,
    action: isDraft ? "judge_score.drafted" : "judge_score.submitted",
    entity: "submission",
    toValue: finalScore === null ? null : String(finalScore),
    metadata: { judgeId: judge.id, submissionId },
  });

  revalidatePath(`/admin/events/${eventId}/results`);

  if (incompleteFinal) {
    const missing = criteriaRows.filter((c) => !isValidScore(scores[c.id]));
    return {
      ok: false,
      submissionId,
      version,
      formError: `Saved as a draft — still need a score for ${missing
        .map((c) => c.label)
        .join(", ")} before this card counts.`,
      fieldErrors: Object.fromEntries(
        missing.map((c) => [c.id, "Needs a score before you can submit."]),
      ),
    };
  }

  return { ok: true, submissionId, saved: isDraft ? "draft" : "final", version };
}

/**
 * Server-action wrapper around `sendScoringLinks`, which lives in a plain module
 * so it is not itself a POST endpoint. The console is a client component and
 * needs an actual action to call.
 */
export async function sendScoringLinksAction(
  eventId: string,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const { sendScoringLinks } = await import("./invite");
  const outcome = await sendScoringLinks(eventId, adminActor(guard.admin));
  if (!outcome.ok) return { ok: false, error: outcome.reason };
  const parts = [`${outcome.sent} sent`];
  if (outcome.skipped) parts.push(`${outcome.skipped} already had one`);
  if (outcome.failed) parts.push(`${outcome.failed} failed to send`);
  return { ok: true, summary: `Scoring links: ${parts.join(", ")}.` };
}

/** Closes scoring: `judging → completed`. Admin-only, called from the console. */
export async function closeJudging(eventId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update")
      .limit(1);
    if (!event) return { ok: false as const, error: "We couldn't find that event." };
    if (!isJudgingOpen(event.status)) {
      return {
        ok: false as const,
        error: `Scoring closes from "judging" — this event is "${event.status}".`,
      };
    }
    await tx
      .update(events)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(events.id, eventId));
    return { ok: true as const, from: event.status };
  });

  if (result.ok) {
    await db.insert(auditLog).values({
      eventId,
      actor: adminActor(guard.admin),
      action: "event.status_changed",
      entity: "event",
      fromValue: result.from,
      toValue: "completed",
    });
    revalidatePath(`/admin/events/${eventId}/results`);
    revalidatePath(`/admin/events/${eventId}`);
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Opens scoring: `live → judging`, which also closes submissions. */
export async function openJudging(eventId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update")
      .limit(1);
    if (!event) return { ok: false as const, error: "We couldn't find that event." };
    if (event.status !== "live") {
      return {
        ok: false as const,
        error: `Judging opens from "live" — this event is "${event.status}".`,
      };
    }
    const [submitted] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.eventId, eventId))
      .limit(1);
    if (!submitted) {
      return {
        ok: false as const,
        error:
          "No projects have been submitted yet. Opening judging now would close submissions on an empty room.",
      };
    }
    await tx
      .update(events)
      .set({ status: "judging", updatedAt: new Date() })
      .where(eq(events.id, eventId));
    return { ok: true as const, from: event.status };
  });

  if (result.ok) {
    await db.insert(auditLog).values({
      eventId,
      actor: adminActor(guard.admin),
      action: "event.status_changed",
      entity: "event",
      fromValue: result.from,
      toValue: "judging",
    });
    revalidatePath(`/admin/events/${eventId}/results`);
    revalidatePath(`/admin/events/${eventId}`);
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

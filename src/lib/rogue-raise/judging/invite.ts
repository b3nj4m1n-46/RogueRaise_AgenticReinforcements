/**
 * Sending judges their scoring links (PRD §7.2).
 *
 * Judges already hold a `judge` token from their invitation, but the raw token
 * only ever existed in that email — it is stored hashed, so it cannot be put
 * into a second one. A fresh token is minted instead; the older one stays valid,
 * which is correct: a judge who kept the first email can still open the
 * background form.
 *
 * Idempotency therefore CANNOT key on "has a live token" the way the submission
 * invites do — every judge always has one. It keys on the audit trail instead:
 * a judge with a recorded `judge_scoring.sent` row for this event is skipped
 * unless the caller explicitly asks to resend.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, events, judges, magicLinkTokens, submissions } from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { generateMagicToken } from "../sponsors/magic-link";
import { JUDGE_ROLE } from "../judges/access";
import { JUDGE_LINK_TTL_MS } from "../judges/send";
import { buildScoringInviteEmail } from "./emails";
import { isJudgingOpen } from "./queries";

export function buildScoringUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/judge/score/${eventId}?token=${raw}`;
}

export type ScoringInviteOutcome =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; reason: string };

export async function sendScoringLinks(
  eventId: string,
  options: { resend?: boolean } = {},
): Promise<ScoringInviteOutcome> {
  const [event] = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return { ok: false, reason: "We couldn't find that event." };
  if (!isJudgingOpen(event.status)) {
    return {
      ok: false,
      reason: `Scoring links go out once judging is open — this event is "${event.status}".`,
    };
  }

  const [judgeRows, submissionRows] = await Promise.all([
    db.select().from(judges).where(eq(judges.eventId, eventId)),
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.eventId, eventId)),
  ]);
  if (judgeRows.length === 0) {
    return { ok: false, reason: "This event has no judges yet." };
  }
  if (submissionRows.length === 0) {
    return {
      ok: false,
      reason: "There's nothing to score — no projects have been submitted.",
    };
  }

  const alreadySent = new Set(
    (
      await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventId, eventId),
            eq(auditLog.action, "judge_scoring.sent"),
          ),
        )
    )
      .map((row) => (row.metadata as { judgeId?: string } | null)?.judgeId)
      .filter((id): id is string => Boolean(id)),
  );

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const judge of judgeRows) {
    if (!options.resend && alreadySent.has(judge.id)) {
      skipped += 1;
      continue;
    }

    const { raw, hash } = generateMagicToken();
    await db.transaction(async (tx) => {
      await tx.insert(magicLinkTokens).values({
        eventId,
        role: JUDGE_ROLE,
        subjectId: judge.id,
        email: judge.email,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + JUDGE_LINK_TTL_MS),
      });
      await tx.insert(auditLog).values({
        eventId,
        actor: "wr-admin",
        action: "judge_scoring.sent",
        entity: "judge",
        toValue: "sent",
        // Ids only — never the raw token.
        metadata: { eventId, judgeId: judge.id },
      });
    });

    const [result] = await Promise.allSettled([
      getEmailAdapter().send(
        buildScoringInviteEmail({
          judgeName: judge.name,
          judgeEmail: judge.email,
          eventTitle: event.title,
          projectCount: submissionRows.length,
          scoringUrl: buildScoringUrl(eventId, raw),
          replyTo: process.env.RR_ADMIN_NOTIFY_EMAIL,
        }),
      ),
    ]);
    if (result.status === "rejected") {
      failed += 1;
      try {
        await db.insert(auditLog).values({
          eventId,
          actor: "system",
          action: "judge_scoring.send_failed",
          entity: "judge",
          metadata: { eventId, judgeId: judge.id },
        });
      } catch (err) {
        console.error("[judging] failed to audit send failure", err);
      }
    } else {
      sent += 1;
    }
  }

  return { ok: true, sent, skipped, failed };
}

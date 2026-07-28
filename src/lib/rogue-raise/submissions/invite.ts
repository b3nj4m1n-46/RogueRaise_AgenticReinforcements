/**
 * Bulk submission invitations (PRD §7.1).
 *
 * **Idempotent by construction.** A participant who already holds a live
 * `participant` token is skipped, so pressing the button twice — which a staff
 * member under time pressure absolutely will — never double-sends. That is the
 * PRD's "idempotent; no duplicate sends" requirement met with a database check
 * rather than a queue's delivery guarantee.
 *
 * ⚠️ PRD §3 specifies **Vercel Queues** for bulk fan-out. This sends inline, in
 * a loop. For a Rogue Raise's scale — tens of participants, not thousands —
 * that is genuinely fine and much easier to reason about. It would not be fine
 * at a scale where the loop outlives the request, and that's the seam to replace.
 */
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../db";
import { auditLog, events, magicLinkTokens, participants } from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { createPacer } from "../integrations/rate-limit";
import { generateMagicToken } from "../sponsors/magic-link";
import { PARTICIPANT_ROLE } from "../participants/access";
import { buildSubmissionInviteEmail } from "./emails";

/** Long enough to outlast the weekend, short enough not to linger. */
export const SUBMISSION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSubmitUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/submit/${eventId}?token=${raw}`;
}

/** Submissions are open while the event is `live`; `judging` closes them. */
export function isSubmissionWindowOpen(status: string): boolean {
  return status === "live";
}

export type InviteOutcome =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; reason: string };

export async function sendSubmissionInvites(
  eventId: string,
  actor: string,
): Promise<InviteOutcome> {
  const [event] = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return { ok: false, reason: "We couldn't find that event." };
  if (!isSubmissionWindowOpen(event.status)) {
    return {
      ok: false,
      reason: `Submissions open while the event is live — this event is "${event.status}". Move it to live first.`,
    };
  }

  const registered = await db
    .select()
    .from(participants)
    .where(eq(participants.eventId, eventId));
  if (registered.length === 0) {
    return { ok: false, reason: "Nobody is registered for this event yet." };
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Paced so a large blast doesn't trip the provider's per-second limit
  // and lose the tail of the list to 429s. See integrations/rate-limit.ts.
  const pacer = createPacer();

  for (const participant of registered) {
    const [live] = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.eventId, eventId),
          eq(magicLinkTokens.role, PARTICIPANT_ROLE),
          eq(magicLinkTokens.subjectId, participant.id),
          isNull(magicLinkTokens.revokedAt),
          gt(magicLinkTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (live) {
      skipped += 1;
      continue;
    }

    const { raw, hash } = generateMagicToken();
    await db.transaction(async (tx) => {
      await tx.insert(magicLinkTokens).values({
        eventId,
        role: PARTICIPANT_ROLE,
        subjectId: participant.id,
        email: participant.email,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + SUBMISSION_LINK_TTL_MS),
      });
      // The audit row is the record of the send; `confirmationSentAt` belongs to
      // registration and stamping it here would misdate that.
      await tx.insert(auditLog).values({
        eventId,
        actor,
        action: "submission_invite.sent",
        entity: "participant",
        toValue: "sent",
        metadata: { eventId, participantId: participant.id },
      });
    });

    await pacer.wait();
    const [result] = await Promise.allSettled([
      getEmailAdapter().send(
        buildSubmissionInviteEmail({
          firstName: participant.firstName,
          email: participant.email,
          eventTitle: event.title,
          submitUrl: buildSubmitUrl(eventId, raw),
        }),
      ),
    ]);
    if (result.status === "rejected") {
      failed += 1;
      // The token stands, so a resend reaches them without a new link.
      try {
        await db.insert(auditLog).values({
          eventId,
          actor: "system",
          action: "submission_invite.send_failed",
          entity: "participant",
          metadata: { eventId, participantId: participant.id },
        });
      } catch (err) {
        console.error("[submissions] failed to audit send failure", err);
      }
    } else {
      sent += 1;
    }
  }

  return { ok: true, sent, skipped, failed };
}

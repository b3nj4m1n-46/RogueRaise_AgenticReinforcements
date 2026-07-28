/**
 * Inviting stakeholders to review the drafts about their own organization
 * (PRD §11.2, §10).
 *
 * Idempotency keys on the audit trail rather than "has a live token": a
 * stakeholder may already hold a token from an earlier phase, so the presence of
 * one says nothing about whether they were asked to review THIS round of drafts.
 * The key is `(event, latest asset version)` — re-running the research agent
 * produces new versions and legitimately warrants a fresh ask.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, events, generatedAssets, magicLinkTokens, stakeholders } from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { createPacer } from "../integrations/rate-limit";
import { generateMagicToken } from "../sponsors/magic-link";
import { buildReviewInviteEmail } from "./emails";
import { STAKEHOLDER_ROLE } from "./access";
import { STAKEHOLDER_REVIEWED_TYPES } from "./review";

/** Long enough to survive a slow week at a county agency. */
export const REVIEW_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function buildReviewUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/review/${eventId}?token=${raw}`;
}

export type ReviewInviteOutcome =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; reason: string };

export async function sendReviewInvites(
  eventId: string,
  actor: string,
  options: { resend?: boolean } = {},
): Promise<ReviewInviteOutcome> {
  const [event] = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return { ok: false, reason: "We couldn't find that event." };

  const [latestAsset] = await db
    .select({ version: generatedAssets.version })
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.eventId, eventId),
        eq(generatedAssets.type, STAKEHOLDER_REVIEWED_TYPES[0]),
      ),
    )
    .orderBy(desc(generatedAssets.version))
    .limit(1);
  if (!latestAsset) {
    return {
      ok: false,
      reason:
        "There are no drafts to review yet — run the context research agent first.",
    };
  }
  const round = latestAsset.version;

  const stakeholderRows = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.eventId, eventId));
  if (stakeholderRows.length === 0) {
    return { ok: false, reason: "This event has no stakeholders recorded." };
  }

  // Keyed on the draft round, so a re-run of the agent legitimately re-asks.
  const alreadyAsked = new Set(
    (
      await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventId, eventId),
            eq(auditLog.action, "stakeholder_review.invited"),
          ),
        )
    )
      .map((row) => row.metadata as { stakeholderId?: string; round?: number } | null)
      .filter((m) => m?.round === round)
      .map((m) => m!.stakeholderId)
      .filter((id): id is string => Boolean(id)),
  );

  const now = new Date();
  const pacer = createPacer();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const stakeholder of stakeholderRows) {
    if (!options.resend && alreadyAsked.has(stakeholder.id)) {
      skipped += 1;
      continue;
    }

    const { raw, hash } = generateMagicToken();
    await db.transaction(async (tx) => {
      await tx.insert(magicLinkTokens).values({
        eventId,
        role: STAKEHOLDER_ROLE,
        subjectId: stakeholder.id,
        email: stakeholder.email,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + REVIEW_LINK_TTL_MS),
      });
      await tx.insert(auditLog).values({
        eventId,
        actor,
        action: "stakeholder_review.invited",
        entity: "stakeholder",
        toValue: "sent",
        // Ids only — never the raw token.
        metadata: { eventId, stakeholderId: stakeholder.id, round },
      });
    });

    await pacer.wait();
    const [result] = await Promise.allSettled([
      getEmailAdapter().send(
        buildReviewInviteEmail({
          stakeholderName: stakeholder.name,
          stakeholderEmail: stakeholder.email,
          eventTitle: event.title,
          reviewUrl: buildReviewUrl(eventId, raw),
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
          action: "stakeholder_review.send_failed",
          entity: "stakeholder",
          metadata: { eventId, stakeholderId: stakeholder.id, round },
        });
      } catch (err) {
        console.error("[stakeholders] failed to audit send failure", err);
      }
    } else {
      sent += 1;
    }
  }

  return { ok: true, sent, skipped, failed };
}

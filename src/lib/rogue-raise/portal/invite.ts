/**
 * Opening the handoff portal (PRD §8, §10).
 *
 * This is the last thing White Rabbit does for an event, and it does two things
 * at once: it grants `can_access_portal` and it sends the link. They are one
 * transaction per stakeholder because a granted flag with no email is a portal
 * nobody knows about, and an email whose token is refused at the door is worse.
 *
 * **The gate is real work being finished, not a date.** The portal shows the
 * judges' evaluations and the winners, so it refuses to open before the event
 * is `completed`. A stakeholder reading scores mid-judging would see numbers
 * that are still moving.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, events, magicLinkTokens, stakeholders, submissions } from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { generateMagicToken } from "../sponsors/magic-link";
import { STAKEHOLDER_ROLE } from "./access";
import { buildPortalInviteEmail } from "./emails";

/**
 * Long. The portal is the deliverable, not a step — a stakeholder coming back
 * in three months to check on a project they adopted is the model working, and
 * an expired link at that moment would be a failure of the whole idea.
 */
export const PORTAL_LINK_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function buildPortalUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/portal/${eventId}?token=${raw}`;
}

/** The portal opens once the event is finished; `archived` keeps it open. */
export function isPortalOpen(status: string): boolean {
  return status === "completed" || status === "archived";
}

export type PortalInviteOutcome =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; reason: string };

export async function openPortal(
  eventId: string,
  options: { resend?: boolean } = {},
): Promise<PortalInviteOutcome> {
  const [event] = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return { ok: false, reason: "We couldn't find that event." };
  if (!isPortalOpen(event.status)) {
    return {
      ok: false,
      reason: `The portal opens once the event is completed — this one is "${event.status}". Close judging first, so the evaluations stakeholders read are final.`,
    };
  }

  const [stakeholderRows, submissionRows] = await Promise.all([
    db.select().from(stakeholders).where(eq(stakeholders.eventId, eventId)),
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.eventId, eventId)),
  ]);
  if (stakeholderRows.length === 0) {
    return {
      ok: false,
      reason:
        "This event has no stakeholders recorded, so there's nobody to hand off to.",
    };
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const stakeholder of stakeholderRows) {
    // Already let in and told — pressing the button again is a no-op unless
    // the caller explicitly asks for a resend.
    if (stakeholder.canAccessPortal && !options.resend) {
      skipped += 1;
      continue;
    }

    const { raw, hash } = generateMagicToken();
    await db.transaction(async (tx) => {
      await tx
        .update(stakeholders)
        .set({ canAccessPortal: true, updatedAt: now })
        .where(eq(stakeholders.id, stakeholder.id));
      await tx.insert(magicLinkTokens).values({
        eventId,
        role: STAKEHOLDER_ROLE,
        subjectId: stakeholder.id,
        email: stakeholder.email,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + PORTAL_LINK_TTL_MS),
      });
      await tx.insert(auditLog).values({
        eventId,
        actor: "wr-admin",
        action: "portal.opened",
        entity: "stakeholder",
        toValue: "sent",
        // Ids only — never the raw token.
        metadata: { eventId, stakeholderId: stakeholder.id },
      });
    });

    const [result] = await Promise.allSettled([
      getEmailAdapter().send(
        buildPortalInviteEmail({
          stakeholderName: stakeholder.name,
          stakeholderEmail: stakeholder.email,
          eventTitle: event.title,
          submissionCount: submissionRows.length,
          portalUrl: buildPortalUrl(eventId, raw),
          replyTo: process.env.RR_ADMIN_NOTIFY_EMAIL,
        }),
      ),
    ]);
    if (result.status === "rejected") {
      failed += 1;
      // The grant and the token stand, so a resend reaches them.
      try {
        await db.insert(auditLog).values({
          eventId,
          actor: "system",
          action: "portal.send_failed",
          entity: "stakeholder",
          metadata: { eventId, stakeholderId: stakeholder.id },
        });
      } catch (err) {
        console.error("[portal] failed to audit send failure", err);
      }
    } else {
      sent += 1;
    }
  }

  return { ok: true, sent, skipped, failed };
}

/** Revokes portal access for one stakeholder — the undo for a wrong address. */
export async function closePortalFor(
  eventId: string,
  stakeholderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [stakeholder] = await db
    .select()
    .from(stakeholders)
    .where(
      and(eq(stakeholders.id, stakeholderId), eq(stakeholders.eventId, eventId)),
    )
    .limit(1);
  if (!stakeholder) return { ok: false, error: "We couldn't find that stakeholder." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(stakeholders)
      .set({ canAccessPortal: false, updatedAt: now })
      .where(eq(stakeholders.id, stakeholderId));
    // Revoke the tokens too: clearing the flag alone would leave live links
    // that merely fail a second check.
    await tx
      .update(magicLinkTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(magicLinkTokens.eventId, eventId),
          eq(magicLinkTokens.role, STAKEHOLDER_ROLE),
          eq(magicLinkTokens.subjectId, stakeholderId),
        ),
      );
    await tx.insert(auditLog).values({
      eventId,
      actor: "wr-admin",
      action: "portal.closed",
      entity: "stakeholder",
      metadata: { eventId, stakeholderId },
    });
  });

  return { ok: true };
}

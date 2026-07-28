"use server";

/**
 * Privileged WR-Admin event actions (PRD §5.2.3).
 *
 *   - `confirmEventWeekend` — lock in ONE weekend. Clearing every other option
 *     and setting this one happen in the same transaction under a `FOR UPDATE`
 *     lock on the event, so "exactly one confirmed" is a database guarantee, not
 *     a UI convention. `events.confirmed_friday_kickoff_at` is written from the
 *     option's own instant and is the single source every downstream artifact
 *     (deck, emails, landing page) reads through `expandSchedule`.
 *
 *   - `resendIntakeInvite` — reissue the sponsor's magic link. Closes the
 *     story-2 gap where an approve-email send failure left a sponsor with no way
 *     into their intake. Prior unexpired `sponsor_poc` tokens for the event are
 *     REVOKED (not deleted — the audit trail survives), so a link sitting in an
 *     old inbox stops working the moment a new one goes out.
 *
 * AUTH: `/admin/*` is env-gated dev-open (src/middleware.ts). There is no
 * Audit rows record the individual admin (`adminActor(guard.admin)`), so "who
 * confirmed this weekend" is answerable.
 * See HANDOFF.md — this must not deploy publicly before the auth story.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "../db";
import {
  auditLog,
  dateOptions,
  events,
  magicLinkTokens,
  organizations,
  sponsorApplications,
} from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { buildIntakeInviteEmail } from "../sponsors/emails";
import {
  buildIntakeInviteUrl,
  generateMagicToken,
  MAGIC_LINK_TTL_MS,
  SPONSOR_POC_ROLE,
} from "../sponsors/magic-link";
import { formatWeekendLabel } from "../intake/schedule";
import { type AdminEventState } from "./state";
import { canConfirmWeekend, canReissueIntakeInvite } from "./status";
import { adminActor, adminOrError } from "../admin/guard";

// --- Helpers ---------------------------------------------------------------

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function nextVersion(prev: AdminEventState): number {
  return (prev.version ?? 0) + 1;
}

function fail(prev: AdminEventState, formError: string): AdminEventState {
  return { ok: false, formError, version: nextVersion(prev) };
}

function succeed(prev: AdminEventState, notice: string): AdminEventState {
  return { ok: true, notice, version: nextVersion(prev) };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Locks the event row so two admins can't interleave a confirmation. */
async function lockEvent(tx: Tx, eventId: string) {
  const [event] = await tx
    .select({
      id: events.id,
      status: events.status,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      sponsorApplicationId: events.sponsorApplicationId,
      orgId: events.orgId,
      title: events.title,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .for("update")
    .limit(1);
  return event ?? null;
}

// --- confirmEventWeekend ---------------------------------------------------

type ConfirmOutcome =
  | { kind: "not_found" }
  | { kind: "wrong_phase" }
  | { kind: "bad_option" }
  | { kind: "ok"; label: string };

export async function confirmEventWeekend(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, formError: guard.error, version: 1 };

  const eventId = str(formData, "event_id");
  const optionId = str(formData, "date_option_id");
  if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(optionId).success) {
    return fail(prevState, "We couldn't find that weekend option.");
  }

  let outcome: ConfirmOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (!event) return { kind: "not_found" as const };
      if (!canConfirmWeekend(event.status)) return { kind: "wrong_phase" as const };

      // Scoped by event id too: an option id from another event is refused
      // rather than silently confirming someone else's weekend.
      const [option] = await tx
        .select({
          id: dateOptions.id,
          fridayKickoffAt: dateOptions.fridayKickoffAt,
        })
        .from(dateOptions)
        .where(and(eq(dateOptions.id, optionId), eq(dateOptions.eventId, eventId)))
        .limit(1);
      if (!option) return { kind: "bad_option" as const };

      const now = new Date();

      // Clear-then-set inside one transaction: never two confirmed, never zero.
      await tx
        .update(dateOptions)
        .set({ isConfirmed: false, updatedAt: now })
        .where(eq(dateOptions.eventId, eventId));
      await tx
        .update(dateOptions)
        .set({ isConfirmed: true, updatedAt: now })
        .where(eq(dateOptions.id, option.id));

      await tx
        .update(events)
        .set({ confirmedFridayKickoffAt: option.fridayKickoffAt, updatedAt: now })
        .where(eq(events.id, eventId));

      await tx.insert(auditLog).values({
        eventId,
        actor: adminActor(guard.admin),
        action: "event.weekend_confirmed",
        entity: "event",
        fromValue: event.confirmedFridayKickoffAt?.toISOString() ?? null,
        toValue: option.fridayKickoffAt.toISOString(),
        metadata: { eventId, dateOptionId: option.id },
      });

      return {
        kind: "ok" as const,
        label: formatWeekendLabel(option.fridayKickoffAt),
      };
    });
  } catch (err) {
    console.error("[admin] confirmEventWeekend transaction failed", err);
    return fail(prevState, "Something went wrong confirming that weekend. Please try again.");
  }

  if (outcome.kind === "not_found") return fail(prevState, "We couldn't find that event.");
  if (outcome.kind === "bad_option") {
    return fail(prevState, "That weekend option doesn't belong to this event.");
  }
  if (outcome.kind === "wrong_phase") {
    return fail(
      prevState,
      "This event is past the point where the weekend can be changed here.",
    );
  }

  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  return succeed(prevState, `Confirmed ${outcome.label} as the event weekend.`);
}

// --- resendIntakeInvite ----------------------------------------------------

type ResendOutcome =
  | { kind: "not_found" }
  | { kind: "wrong_phase" }
  | { kind: "no_poc" }
  | {
      kind: "ok";
      orgName: string;
      pocName: string;
      pocEmail: string;
      intakeUrl: string;
      revokedCount: number;
    };

export async function resendIntakeInvite(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, formError: guard.error, version: 1 };

  const eventId = str(formData, "event_id");
  if (!z.uuid().safeParse(eventId).success) {
    return fail(prevState, "We couldn't find that event.");
  }

  let outcome: ResendOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (!event) return { kind: "not_found" as const };
      if (!canReissueIntakeInvite(event.status)) {
        return { kind: "wrong_phase" as const };
      }
      if (!event.sponsorApplicationId) return { kind: "no_poc" as const };

      const [application] = await tx
        .select({
          pocName: sponsorApplications.pocName,
          pocEmail: sponsorApplications.pocEmail,
        })
        .from(sponsorApplications)
        .where(eq(sponsorApplications.id, event.sponsorApplicationId))
        .limit(1);
      if (!application) return { kind: "no_poc" as const };

      const now = new Date();

      // Revoke, don't delete — the trail of what was issued stays intact.
      const revoked = await tx
        .update(magicLinkTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(magicLinkTokens.eventId, eventId),
            eq(magicLinkTokens.role, SPONSOR_POC_ROLE),
            isNull(magicLinkTokens.revokedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .returning({ id: magicLinkTokens.id });

      const { raw, hash } = generateMagicToken();
      await tx.insert(magicLinkTokens).values({
        eventId,
        role: SPONSOR_POC_ROLE,
        subjectId: event.sponsorApplicationId,
        email: application.pocEmail,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
      });

      await tx.insert(auditLog).values({
        eventId,
        actor: adminActor(guard.admin),
        action: "magic_link.reissued",
        entity: "magic_link_token",
        fromValue: String(revoked.length),
        toValue: "1",
        // Ids and counts only — the raw token is never recorded anywhere.
        metadata: { eventId, revokedCount: revoked.length },
      });

      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, event.orgId))
        .limit(1);

      return {
        kind: "ok" as const,
        orgName: org?.name ?? event.title,
        pocName: application.pocName,
        pocEmail: application.pocEmail,
        intakeUrl: buildIntakeInviteUrl(eventId, raw),
        revokedCount: revoked.length,
      };
    });
  } catch (err) {
    console.error("[admin] resendIntakeInvite transaction failed", err);
    return fail(prevState, "Something went wrong reissuing that link. Please try again.");
  }

  if (outcome.kind === "not_found") return fail(prevState, "We couldn't find that event.");
  if (outcome.kind === "wrong_phase") {
    return fail(prevState, "This event is past the intake stage, so there's no link to reissue.");
  }
  if (outcome.kind === "no_poc") {
    return fail(prevState, "This event has no sponsor contact to send a link to.");
  }

  // Email AFTER commit — a send failure is audit-logged, never rolled back. The
  // old links are already dead at this point, which is the safe direction to fail.
  const sends = await Promise.allSettled([
    getEmailAdapter().send(
      buildIntakeInviteEmail({
        orgName: outcome.orgName,
        pocName: outcome.pocName,
        pocEmail: outcome.pocEmail,
        intakeUrl: outcome.intakeUrl,
        reissued: true,
      }),
    ),
  ]);
  const failed = sends.filter((s) => s.status === "rejected").length;
  if (failed > 0) {
    try {
      await db.insert(auditLog).values({
        eventId,
        actor: "system",
        action: "magic_link.reissue_email_failed",
        entity: "magic_link_token",
        metadata: { eventId },
      });
    } catch (err) {
      console.error("[admin] failed to audit reissue email failure", err);
    }
    revalidatePath(`/admin/events/${eventId}`);
    return fail(
      prevState,
      `A new link was created, but the email didn't send. The previous link no longer works — try again, or contact ${outcome.pocEmail} directly.`,
    );
  }

  revalidatePath(`/admin/events/${eventId}`);
  return succeed(
    prevState,
    outcome.revokedCount > 0
      ? `Sent a fresh intake link to ${outcome.pocEmail}. ${outcome.revokedCount} earlier link(s) stopped working.`
      : `Sent a fresh intake link to ${outcome.pocEmail}.`,
  );
}

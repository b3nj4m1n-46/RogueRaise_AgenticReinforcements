/**
 * Sending approved judge invitations (PRD §5.3.3 third AC).
 *
 * Only an APPROVED `judge_email` asset can be sent — the review gate is the
 * whole point, and this is the step where an agent's words actually reach a
 * person outside White Rabbit.
 *
 * Each judge gets their own magic link, minted here so the raw token exists only
 * in the email that carries it. Delivery is logged per judge in the audit log:
 * one row per judge, so "did Ada get hers?" is answerable.
 *
 * Idempotent by design: a judge who already has a live token and a recorded
 * send is skipped rather than emailed twice. A resend is an explicit choice.
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "../db";
import { auditLog, generatedAssets, judges, magicLinkTokens } from "../db/schema";
import { loadAdminEvent } from "../events/queries";
import { getEmailAdapter } from "../integrations/email";
import { generateMagicToken } from "../sponsors/magic-link";
import { JUDGE_ROLE } from "./access";
import { buildJudgeInvitationEmail } from "./emails";
import {
  splitJudgeLetters,
  type JudgeLetter,
} from "../agents/handlers/judge-invitation-prompts";

/** Judge links must outlast the gap between invitation and the event weekend. */
export const JUDGE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function buildJudgeBackgroundUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/judge/background/${eventId}?token=${raw}`;
}

export type SendOutcome =
  | { ok: true; sent: number; skipped: number; unmatched: string[] }
  | { ok: false; reason: string };

export async function sendJudgeInvitations(eventId: string): Promise<SendOutcome> {
  const detail = await loadAdminEvent(eventId);
  if (!detail) return { ok: false, reason: "We couldn't find that event." };

  const [asset] = await db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.eventId, eventId),
        eq(generatedAssets.type, "judge_email"),
      ),
    )
    .orderBy(desc(generatedAssets.version))
    .limit(1);

  if (!asset) {
    return { ok: false, reason: "No judge invitations have been drafted yet." };
  }
  if (asset.reviewStatus !== "approved") {
    return {
      ok: false,
      reason: `The invitations are ${asset.reviewStatus.replace(/_/g, " ")} — they need approving before anything is sent.`,
    };
  }

  const letters = splitJudgeLetters(asset.body ?? "");
  if (letters.length === 0) {
    return {
      ok: false,
      reason:
        "The draft has no per-judge letters in it. Each letter must start with a `## JUDGE: <email>` line — re-run the agent, or add the markers by editing the draft.",
    };
  }

  const judgeRows = await db.select().from(judges).where(eq(judges.eventId, eventId));
  const byEmail = new Map(judgeRows.map((j) => [j.email.toLowerCase(), j]));

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (const letter of letters) {
    const judge = byEmail.get(letter.email.toLowerCase());
    if (!judge) {
      // A letter addressed to someone who isn't a judge on this event is never
      // sent — the agent may have invented or mistyped an address.
      unmatched.push(letter.email);
      continue;
    }

    const [live] = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.eventId, eventId),
          eq(magicLinkTokens.role, JUDGE_ROLE),
          eq(magicLinkTokens.subjectId, judge.id),
          isNull(magicLinkTokens.revokedAt),
          gt(magicLinkTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (live) {
      skipped += 1;
      continue;
    }

    await sendOne(eventId, judge, letter, detail, now);
    sent += 1;
  }

  return { ok: true, sent, skipped, unmatched };
}

type JudgeRow = typeof judges.$inferSelect;
type EventDetail = NonNullable<Awaited<ReturnType<typeof loadAdminEvent>>>;

async function sendOne(
  eventId: string,
  judge: JudgeRow,
  letter: JudgeLetter,
  detail: EventDetail,
  now: Date,
): Promise<void> {
  // Mint first, inside a transaction with the audit row, so a token always has
  // a record of why it exists.
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
      action: "judge_email.sent",
      entity: "judge",
      toValue: "sent",
      // Ids only — never the raw token, never the letter.
      metadata: { eventId, judgeId: judge.id },
    });
  });

  const message = buildJudgeInvitationEmail({
    judgeName: judge.name,
    judgeEmail: judge.email,
    eventTitle: detail.title,
    organizationName: detail.organizationName,
    body: letter.body,
    backgroundUrl: buildJudgeBackgroundUrl(eventId, raw),
    replyTo: process.env.RR_ADMIN_NOTIFY_EMAIL,
  });

  const [result] = await Promise.allSettled([getEmailAdapter().send(message)]);
  if (result.status === "rejected") {
    // The token stands — the admin can resend without the judge losing their
    // link — but the failure is recorded so nobody assumes it arrived.
    try {
      await db.insert(auditLog).values({
        eventId,
        actor: "system",
        action: "judge_email.send_failed",
        entity: "judge",
        metadata: { eventId, judgeId: judge.id },
      });
    } catch (err) {
      console.error("[judges] failed to audit send failure", err);
    }
  }
}

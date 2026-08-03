/**
 * Magic-link access for the judge background form (PRD §5.3.4).
 *
 * A judge's token is minted when their invitation is sent, scoped to one event
 * and one judge (`subject_id`). Like the sponsor intake it is multi-use within
 * its TTL — a judge who half-fills the form and comes back later should not be
 * locked out — so `consumed_at` stays null and expiry/revocation are the controls.
 */
import { eq } from "drizzle-orm";

import { redeemMagicToken } from "../access/redeem";
import { db } from "../db";
import { judges } from "../db/schema";

export const JUDGE_ROLE = "judge" as const;

export interface JudgeAccess {
  tokenId: string;
  judge: {
    id: string;
    name: string;
    email: string;
    title: string | null;
    bio: string | null;
    expertiseTags: string[];
    introPreference: string | null;
    criteriaQuestions: string | null;
    headshotBlobUrl: string | null;
    backgroundCompletedAt: string | null;
  };
  event: {
    id: string;
    title: string;
    organizationName: string;
    status: string;
  };
}

export type JudgeAccessResult =
  | { ok: true; access: JudgeAccess }
  | { ok: false; reason: string };

export async function redeemJudgeToken(input: {
  rawToken: string;
  eventId?: string;
  now?: Date;
}): Promise<JudgeAccessResult> {
  const result = await redeemMagicToken({
    rawToken: input.rawToken,
    role: JUDGE_ROLE,
    eventId: input.eventId,
    now: input.now,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  const { token } = result;
  if (!token.subjectId) return { ok: false, reason: "invalid" };

  const [judge] = await db
    .select()
    .from(judges)
    .where(eq(judges.id, token.subjectId))
    .limit(1);
  // A token whose judge was removed is indistinguishable from a bad token.
  if (!judge || judge.eventId !== token.event.id) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    access: {
      tokenId: token.tokenId,
      judge: {
        id: judge.id,
        name: judge.name,
        email: judge.email,
        title: judge.title,
        bio: judge.bio,
        expertiseTags: judge.expertiseTags ?? [],
        introPreference: judge.introPreference,
        criteriaQuestions: judge.criteriaQuestions,
        headshotBlobUrl: judge.headshotBlobUrl,
        backgroundCompletedAt: judge.backgroundCompletedAt?.toISOString() ?? null,
      },
      event: {
        id: token.event.id,
        title: token.event.title,
        organizationName: token.event.organizationName,
        status: token.event.status,
      },
    },
  };
}

/** POC-facing copy for each failure. Never leaks internals. */
export const JUDGE_ACCESS_MESSAGES: Record<string, string> = {
  invalid:
    "This link isn't valid. Please use the most recent link we emailed you, or reply to that email and we'll send a new one.",
  expired:
    "This link has expired. Reply to our invitation email and we'll send you a fresh one.",
  revoked:
    "This link has been turned off. Reply to our invitation email and we'll send you a new one.",
  wrong_event: "This link is for a different Rogue Raise.",
  wrong_role: "This link doesn't open the judge form.",
};

export function judgeAccessMessage(reason: string): string {
  return JUDGE_ACCESS_MESSAGES[reason] ?? JUDGE_ACCESS_MESSAGES.invalid;
}

/**
 * Stakeholder access for DRAFT REVIEW (PRD §11.2), as distinct from the handoff
 * portal.
 *
 * These are the same people and the same `stakeholder` role, but a different
 * moment: review happens around `repo_review`, months before the portal opens.
 * `can_access_portal` therefore must NOT gate it — that flag means "the event is
 * finished and your results are ready", and requiring it here would make review
 * impossible by construction.
 *
 * The portal's own redeemer (`portal/access.ts`) keeps its stricter check. Two
 * readers over one role, each honest about what it is letting someone see.
 */
import { eq } from "drizzle-orm";

import { redeemMagicToken } from "../access/redeem";
import { db } from "../db";
import { stakeholders } from "../db/schema";

export const STAKEHOLDER_ROLE = "stakeholder" as const;

export interface StakeholderReviewAccess {
  tokenId: string;
  stakeholder: { id: string; name: string; email: string };
  event: {
    id: string;
    title: string;
    organizationName: string;
    status: string;
  };
}

export type StakeholderReviewResult =
  | { ok: true; access: StakeholderReviewAccess }
  | { ok: false; reason: string };

export async function redeemStakeholderReviewToken(input: {
  rawToken: string;
  eventId?: string;
  now?: Date;
}): Promise<StakeholderReviewResult> {
  const result = await redeemMagicToken({
    rawToken: input.rawToken,
    role: STAKEHOLDER_ROLE,
    eventId: input.eventId,
    now: input.now,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  const { token } = result;
  if (!token.subjectId) return { ok: false, reason: "invalid" };

  const [stakeholder] = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.id, token.subjectId))
    .limit(1);
  // A token whose stakeholder was removed is indistinguishable from a bad one.
  if (!stakeholder || stakeholder.eventId !== token.event.id) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    access: {
      tokenId: token.tokenId,
      stakeholder: {
        id: stakeholder.id,
        name: stakeholder.name,
        email: stakeholder.email,
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

export const REVIEW_ACCESS_MESSAGES: Record<string, string> = {
  invalid:
    "This link isn't valid. Please use the most recent link we emailed you, or reply to that email and we'll send a new one.",
  expired:
    "This link has expired. Reply to the email we sent you and we'll send a fresh one.",
  revoked:
    "This link has been turned off. Reply to the email we sent you and we'll send a new one.",
  wrong_event: "This link is for a different Rogue Raise.",
  wrong_role: "This link doesn't open the review.",
};

export function reviewAccessMessage(reason: string): string {
  return REVIEW_ACCESS_MESSAGES[reason] ?? REVIEW_ACCESS_MESSAGES.invalid;
}

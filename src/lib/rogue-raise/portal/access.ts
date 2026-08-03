/**
 * Magic-link access to the stakeholder handoff portal (PRD §8, §12).
 *
 * The scoping AC here is the strictest in the PRD — *"a Stakeholder sees only
 * their event's portal"* — so this checks three things, not one: the token's
 * role, the token's event, and that the stakeholder row it points at still
 * belongs to that event. A token whose stakeholder was moved or removed is
 * indistinguishable from a bad token.
 *
 * `can_access_portal` is a second, deliberate gate: a stakeholder is recorded
 * during intake, but portal access is granted when WR decides the portal is
 * ready. Being named on an event is not the same as being let in.
 */
import { eq } from "drizzle-orm";

import { redeemMagicToken } from "../access/redeem";
import { db } from "../db";
import { stakeholders } from "../db/schema";

export const STAKEHOLDER_ROLE = "stakeholder" as const;

export interface StakeholderAccess {
  tokenId: string;
  stakeholder: { id: string; name: string; email: string };
  event: {
    id: string;
    title: string;
    organizationName: string;
    status: string;
  };
}

export type StakeholderAccessResult =
  | { ok: true; access: StakeholderAccess }
  | { ok: false; reason: string };

export async function redeemStakeholderToken(input: {
  rawToken: string;
  eventId?: string;
  now?: Date;
}): Promise<StakeholderAccessResult> {
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
  if (!stakeholder || stakeholder.eventId !== token.event.id) {
    return { ok: false, reason: "invalid" };
  }
  if (!stakeholder.canAccessPortal) return { ok: false, reason: "not_open" };

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

/** Stakeholder-facing copy for each failure. Never leaks internals. */
export const STAKEHOLDER_ACCESS_MESSAGES: Record<string, string> = {
  invalid:
    "This link isn't valid. Please use the most recent link we emailed you, or reply to that email and we'll send a new one.",
  expired:
    "This link has expired. Reply to the email we sent you and we'll send a fresh one.",
  revoked:
    "This link has been turned off. Reply to the email we sent you and we'll send a new one.",
  wrong_event: "This link is for a different Rogue Raise.",
  wrong_role: "This link doesn't open the handoff portal.",
  not_open:
    "Your portal isn't open yet — we'll email you the moment it is. If you were expecting it today, reply to that email and we'll sort it out.",
};

export function stakeholderAccessMessage(reason: string): string {
  return STAKEHOLDER_ACCESS_MESSAGES[reason] ?? STAKEHOLDER_ACCESS_MESSAGES.invalid;
}

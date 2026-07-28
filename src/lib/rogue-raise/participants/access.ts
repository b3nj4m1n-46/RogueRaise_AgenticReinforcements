/**
 * Magic-link access for participants (the submission form, PRD §7.1).
 *
 * A participant's token is minted when the submission invite goes out, scoped
 * to one event and one participant. Multi-use within its TTL: a team that
 * starts the form and comes back must not be locked out at 4pm on a Sunday.
 */
import { eq } from "drizzle-orm";

import { redeemMagicToken } from "../access/redeem";
import { db } from "../db";
import { participants } from "../db/schema";

export const PARTICIPANT_ROLE = "participant" as const;

export interface ParticipantAccess {
  tokenId: string;
  participant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  event: {
    id: string;
    title: string;
    organizationName: string;
    status: string;
  };
}

export type ParticipantAccessResult =
  | { ok: true; access: ParticipantAccess }
  | { ok: false; reason: string };

export async function redeemParticipantToken(input: {
  rawToken: string;
  eventId?: string;
  now?: Date;
}): Promise<ParticipantAccessResult> {
  const result = await redeemMagicToken({
    rawToken: input.rawToken,
    role: PARTICIPANT_ROLE,
    eventId: input.eventId,
    now: input.now,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  const { token } = result;
  if (!token.subjectId) return { ok: false, reason: "invalid" };

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, token.subjectId))
    .limit(1);
  if (!participant || participant.eventId !== token.event.id) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    access: {
      tokenId: token.tokenId,
      participant: {
        id: participant.id,
        firstName: participant.firstName,
        lastName: participant.lastName,
        email: participant.email,
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

export const PARTICIPANT_ACCESS_MESSAGES: Record<string, string> = {
  invalid:
    "This link isn't valid. Use the link from the submission email we sent, or ask an organizer.",
  expired: "This link has expired. Ask an organizer for a new one.",
  revoked: "This link has been turned off. Ask an organizer for a new one.",
  wrong_event: "This link is for a different Rogue Raise.",
  wrong_role: "This link doesn't open the submission form.",
};

export function participantAccessMessage(reason: string): string {
  return PARTICIPANT_ACCESS_MESSAGES[reason] ?? PARTICIPANT_ACCESS_MESSAGES.invalid;
}

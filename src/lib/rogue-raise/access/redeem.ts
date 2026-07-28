/**
 * Magic-link redemption, shared by every externally-facing role.
 *
 * Extracted when the judge background form became the second caller: the sponsor
 * intake proved the shape, and duplicating a security check is how the two
 * copies drift. Role-specific wrappers (`intake/access.ts`, `judges/access.ts`)
 * add what their surface needs on top of this.
 *
 * Security posture, unchanged from the intake story:
 *   - The raw token is hashed with the shared `hashMagicToken` (HMAC-SHA256) and
 *     looked up by hash; the raw value is never stored, logged, or audited.
 *   - The found hash is re-compared with `timingSafeEqual` — defence in depth on
 *     top of the indexed lookup.
 *   - A token is scoped to ONE event and ONE role.
 *   - Every failure reachable WITHOUT holding a real token collapses into the
 *     single opaque `invalid` reason. The specific reasons are only ever
 *     returned to someone who already presented a genuine token.
 */
import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { events, magicLinkTokens, organizations } from "../db/schema";
import { hashMagicToken } from "../sponsors/magic-link";

export type MagicLinkFailure =
  | "invalid"
  | "expired"
  | "revoked"
  | "wrong_event"
  | "wrong_role";

export interface RedeemedToken {
  tokenId: string;
  /** Address the link was issued to. */
  email: string;
  /** Row this token is *about* — a sponsor application, a judge, a participant. */
  subjectId: string | null;
  expiresAt: Date;
  event: {
    id: string;
    title: string;
    slug: string;
    status: string;
    orgId: string;
    organizationName: string;
  };
}

export type RedeemResult =
  | { ok: true; token: RedeemedToken }
  | { ok: false; reason: MagicLinkFailure };

/** Raw tokens are `randomBytes(32).toString("base64url")` — 43 URL-safe chars. */
const RAW_TOKEN_REGEX = /^[A-Za-z0-9_-]{20,200}$/;

/** Constant-time hex-digest comparison; length mismatch is an immediate false. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export async function redeemMagicToken(input: {
  rawToken: string;
  /** The role the surface requires — anything else is `wrong_role`. */
  role: string;
  /** When set, the token must belong to this event. */
  eventId?: string;
  now?: Date;
}): Promise<RedeemResult> {
  const now = input.now ?? new Date();

  if (input.eventId && !z.uuid().safeParse(input.eventId).success) {
    return { ok: false, reason: "invalid" };
  }
  if (!RAW_TOKEN_REGEX.test(input.rawToken)) {
    return { ok: false, reason: "invalid" };
  }

  const tokenHash = hashMagicToken(input.rawToken);

  const [row] = await db
    .select({
      id: magicLinkTokens.id,
      eventId: magicLinkTokens.eventId,
      role: magicLinkTokens.role,
      email: magicLinkTokens.email,
      subjectId: magicLinkTokens.subjectId,
      tokenHash: magicLinkTokens.tokenHash,
      expiresAt: magicLinkTokens.expiresAt,
      revokedAt: magicLinkTokens.revokedAt,
    })
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || !hashesMatch(row.tokenHash, tokenHash)) {
    return { ok: false, reason: "invalid" };
  }

  // Everything below is only reachable by someone holding a real token.
  if (row.role !== input.role) return { ok: false, reason: "wrong_role" };
  if (input.eventId && row.eventId !== input.eventId) {
    return { ok: false, reason: "wrong_event" };
  }
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const [event] = await db
    .select({
      id: events.id,
      title: events.title,
      slug: events.slug,
      status: events.status,
      orgId: events.orgId,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(eq(events.id, row.eventId))
    .limit(1);

  // A token whose event vanished is indistinguishable from a bad token.
  if (!event) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    token: {
      tokenId: row.id,
      email: row.email,
      subjectId: row.subjectId,
      expiresAt: row.expiresAt,
      event,
    },
  };
}

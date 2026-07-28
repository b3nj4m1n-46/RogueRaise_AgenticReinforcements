/**
 * Magic-link access control for the sponsor intake form.
 *
 * The approve action (story 2) MINTS a `sponsor_poc` token; this module VERIFIES
 * one. It is the only door into `/sponsor/intake/*` until Better Auth's
 * `magicLink` plugin lands, so it runs on EVERY read and EVERY write — the page
 * render is never treated as authorization for the actions beneath it.
 *
 * Security posture:
 *   - The raw token is hashed with the shared `hashMagicToken` (HMAC-SHA256) and
 *     looked up by hash; the raw value is never stored, logged, or audited.
 *   - The found hash is re-compared with `timingSafeEqual` — defence in depth on
 *     top of the indexed lookup.
 *   - The token is scoped to ONE event and ONE role: a valid token for Event A
 *     is refused on Event B (`wrong_event`), and a judge/participant token can
 *     never open the sponsor intake (`wrong_role`).
 *   - Every failure that could be reached WITHOUT holding a real token collapses
 *     into the single opaque `invalid` reason. The more specific reasons
 *     (expired/revoked/wrong_event/wrong_role) are only ever returned to someone
 *     who already presented a genuine token, so they leak nothing.
 *
 * Multi-use by design: the intake form is resumable across sittings, so
 * `consumed_at` is deliberately NOT set here. `expires_at` (14 days) and
 * `revoked_at` are the controls. `consumed_at` stays reserved for genuinely
 * single-use flows (e.g. a future one-shot judge confirmation).
 */
import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { events, magicLinkTokens, organizations } from "../db/schema";
import { hashMagicToken, SPONSOR_POC_ROLE } from "../sponsors/magic-link";

/** Why access was refused. `invalid` is the deliberately opaque catch-all. */
export type IntakeAccessFailure =
  | "invalid"
  | "expired"
  | "revoked"
  | "wrong_event"
  | "wrong_role";

export interface IntakeAccess {
  tokenId: string;
  /** Address the link was issued to — shown so the POC knows whose link this is. */
  email: string;
  expiresAt: Date;
  event: {
    id: string;
    title: string;
    slug: string;
    status: string;
    orgId: string;
  };
  organizationName: string;
}

export type IntakeAccessResult =
  | { ok: true; access: IntakeAccess }
  | { ok: false; reason: IntakeAccessFailure };

/**
 * Statuses during which the POC may still edit their intake. Before
 * `intake_pending` the event isn't approved; from `repo_generating` onward the
 * agent layer has consumed the intake, and the wholesale collection replacement
 * in `saveIntake` would no longer be safe.
 */
export const EDITABLE_INTAKE_STATUSES = [
  "intake_pending",
  "intake_complete",
] as const;

export function canEditIntake(eventStatus: string): boolean {
  return (EDITABLE_INTAKE_STATUSES as readonly string[]).includes(eventStatus);
}

/** Raw tokens are `randomBytes(32).toString("base64url")` — 43 URL-safe chars. */
const RAW_TOKEN_REGEX = /^[A-Za-z0-9_-]{20,200}$/;

/** Constant-time hex-digest comparison; length mismatch is an immediate false. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export async function redeemIntakeToken(input: {
  eventId: string;
  rawToken: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}): Promise<IntakeAccessResult> {
  const now = input.now ?? new Date();

  // Shape checks first — a malformed id or token never reaches the database.
  if (!z.uuid().safeParse(input.eventId).success) {
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
      tokenHash: magicLinkTokens.tokenHash,
      expiresAt: magicLinkTokens.expiresAt,
      revokedAt: magicLinkTokens.revokedAt,
    })
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, tokenHash))
    .limit(1);

  // No row, or a hash that doesn't survive the constant-time re-check.
  if (!row || !hashesMatch(row.tokenHash, tokenHash)) {
    return { ok: false, reason: "invalid" };
  }

  // Everything below here is only reachable by someone holding a real token.
  if (row.role !== SPONSOR_POC_ROLE) return { ok: false, reason: "wrong_role" };
  if (row.eventId !== input.eventId) return { ok: false, reason: "wrong_event" };
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
    access: {
      tokenId: row.id,
      email: row.email,
      expiresAt: row.expiresAt,
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        status: event.status,
        orgId: event.orgId,
      },
      organizationName: event.organizationName,
    },
  };
}

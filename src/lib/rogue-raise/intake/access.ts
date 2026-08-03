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
import { redeemMagicToken } from "../access/redeem";
import { SPONSOR_POC_ROLE } from "../sponsors/magic-link";

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

export async function redeemIntakeToken(input: {
  eventId: string;
  rawToken: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}): Promise<IntakeAccessResult> {
  const result = await redeemMagicToken({
    rawToken: input.rawToken,
    role: SPONSOR_POC_ROLE,
    eventId: input.eventId,
    now: input.now,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  const { token } = result;
  return {
    ok: true,
    access: {
      tokenId: token.tokenId,
      email: token.email,
      expiresAt: token.expiresAt,
      event: {
        id: token.event.id,
        title: token.event.title,
        slug: token.event.slug,
        status: token.event.status,
        orgId: token.event.orgId,
      },
      organizationName: token.event.organizationName,
    },
  };
}

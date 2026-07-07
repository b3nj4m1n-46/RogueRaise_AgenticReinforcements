/**
 * Magic-link token helper — shared by the admin approve action (which MINTS a
 * token) and the future sponsor-intake redemption story (which VERIFIES one).
 *
 * Design (per story-2 resolved decisions):
 *   - Raw token = `randomBytes(32).toString("base64url")` — URL-safe, high-entropy,
 *     appears ONLY in the emailed URL. It is never stored, logged, or audited.
 *   - Stored value = `HMAC-SHA256(raw, secret)` hex, in `magic_link_tokens.token_hash`.
 *   - TTL = 14 days (must outlast the gap until the intake form ships).
 *
 * Redemption (next story) MUST reuse `hashMagicToken` and compare with
 * `crypto.timingSafeEqual`, never a plain `===`, to avoid a timing oracle.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Role stamped on the minted token — matches the `magic_link_role` enum. */
export const SPONSOR_POC_ROLE = "sponsor_poc" as const;

/** 14 days, in milliseconds. `expiresAt = now + MAGIC_LINK_TTL_MS`. */
export const MAGIC_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Signing secret for token hashing. Prefers `RR_MAGIC_LINK_SECRET` (its dedicated
 * env), then falls back to `RR_SPAM_SECRET`, then a dev default — the same
 * never-empty fallback discipline as `getSpamSecret`, but with magic-link's own
 * secret FIRST so the two seams can diverge in prod.
 *
 * Outside development the committed default is a real vulnerability (token
 * hashes become forgeable), so production fails fast instead of falling back.
 */
export function getMagicLinkSecret(): string {
  const secret =
    process.env.RR_MAGIC_LINK_SECRET ?? process.env.RR_SPAM_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RR_MAGIC_LINK_SECRET (or RR_SPAM_SECRET) must be set in production — magic-link tokens signed with the public dev default are forgeable.",
    );
  }
  return "dev-magic-link-secret-change-me";
}

/** HMAC-SHA256(raw) as lowercase hex — the value stored in `token_hash`. */
export function hashMagicToken(raw: string): string {
  return createHmac("sha256", getMagicLinkSecret()).update(raw).digest("hex");
}

/**
 * Mint a fresh token: `raw` goes in the emailed URL, `hash` goes in the DB.
 * Callers must never persist or log `raw`.
 */
export function generateMagicToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashMagicToken(raw) };
}

/**
 * Absolute intake-invite URL for the emailed link. Base comes from
 * `BETTER_AUTH_URL` (never a request Host header) so the link is stable and
 * un-spoofable. Shape: `<base>/sponsor/intake/<eventId>?token=<raw>`.
 */
export function buildIntakeInviteUrl(eventId: string, raw: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  // eventId is a UUID and `raw` is base64url — both are already URL-safe.
  return `${base}/sponsor/intake/${eventId}?token=${raw}`;
}

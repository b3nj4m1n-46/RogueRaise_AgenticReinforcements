/**
 * Spam-guard seam. Mirrors the `email`/`blob` adapters: an interface + a factory
 * (`getSpamGuard()`) that returns a dev fallback with no credentials and swaps to
 * a real provider (Vercel BotID / hCaptcha) behind the same contract in prod.
 *
 * Dev impl = two cheap, stateless signals:
 *   1. Honeypot — a decoy field that real users never fill; bots do.
 *   2. HMAC-signed timestamp — the page issues a signed `renderedAt`; on submit we
 *      verify the signature and require a human-plausible elapsed window
 *      (>= 3s to defeat instant bot posts, <= 1h to defeat stale replays).
 *
 * Signed with `RR_SPAM_SECRET`, falling back to `RR_MAGIC_LINK_SECRET` so the
 * flow runs on a laptop with the base M0 env.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SpamChallenge {
  /** Epoch millis (as a string) when the challenge was issued. */
  renderedAt: string;
  /** HMAC signature over `renderedAt`. */
  sig: string;
}

export interface SpamVerifyInput {
  /** Honeypot field value — MUST be empty for a human. */
  honeypot: string | null | undefined;
  /** The `renderedAt` echoed back from the issued challenge. */
  renderedAt: string | null | undefined;
  /** The `sig` echoed back from the issued challenge. */
  sig: string | null | undefined;
  /** Injectable clock for tests; defaults to `Date.now()`. */
  now?: number;
}

export interface SpamVerifyResult {
  ok: boolean;
  /** Machine-readable reason (never surfaced verbatim to users). */
  reason?: string;
}

export interface SpamGuard {
  issueChallenge(): SpamChallenge;
  verify(input: SpamVerifyInput): SpamVerifyResult;
}

const MIN_ELAPSED_MS = 3_000; // faster than 3s == almost certainly a bot.
const MAX_ELAPSED_MS = 60 * 60 * 1_000; // older than 1h == stale/replayed.

function getSecret(): string {
  return (
    process.env.RR_SPAM_SECRET ??
    process.env.RR_MAGIC_LINK_SECRET ??
    "dev-spam-secret-change-me"
  );
}

function sign(renderedAt: string): string {
  return createHmac("sha256", getSecret()).update(renderedAt).digest("hex");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  // Length-guard before timingSafeEqual (it throws on mismatched lengths).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const devSpamGuard: SpamGuard = {
  issueChallenge() {
    const renderedAt = Date.now().toString();
    return { renderedAt, sig: sign(renderedAt) };
  },

  verify(input) {
    // 1. Honeypot must be empty.
    if (input.honeypot && input.honeypot.trim() !== "") {
      return { ok: false, reason: "honeypot_filled" };
    }

    const { renderedAt, sig } = input;
    if (!renderedAt || !sig) {
      return { ok: false, reason: "missing_challenge" };
    }

    // 2. Signature must verify.
    if (!signaturesMatch(sign(renderedAt), sig)) {
      return { ok: false, reason: "bad_signature" };
    }

    const issuedAt = Number(renderedAt);
    if (!Number.isFinite(issuedAt)) {
      return { ok: false, reason: "bad_timestamp" };
    }

    // 3. Elapsed window must be human-plausible.
    const elapsed = (input.now ?? Date.now()) - issuedAt;
    if (elapsed < MIN_ELAPSED_MS) {
      return { ok: false, reason: "too_fast" };
    }
    if (elapsed > MAX_ELAPSED_MS) {
      return { ok: false, reason: "too_old" };
    }

    return { ok: true };
  },
};

let guard: SpamGuard | undefined;

export function getSpamGuard(): SpamGuard {
  if (guard) return guard;
  // Real BotID/hCaptcha implementation swaps in here when the prod story lands;
  // until then the honeypot + signed-timestamp fallback keeps the seam usable.
  guard = devSpamGuard;
  return guard;
}

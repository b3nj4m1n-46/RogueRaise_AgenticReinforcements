/**
 * Send pacing for bulk email (PRD §10: bulk sends are "queued, rate-limited,
 * idempotent, and delivery-tracked").
 *
 * Idempotency and delivery tracking already exist — each bulk sender skips
 * anyone who already has a live link and writes one audit row per recipient.
 * This is the missing third property: a floor on the interval between sends, so
 * a 60-participant blast doesn't hit Resend's per-second limit and lose the tail
 * of the list to 429s.
 *
 * **This is a pacer, not a queue.** It holds the request open for the duration
 * of the send, which is correct at a Rogue Raise's scale (tens of recipients,
 * a few seconds) and wrong at a scale where the loop would outlive the function
 * timeout. PRD §3 names Vercel Queues as the destination; `pace()` is the seam
 * where that swap happens, and the numbers below are what to reproduce in the
 * queue's own rate configuration.
 */

/**
 * Resend's documented default is 2 requests/second. 600ms leaves headroom for
 * clock skew and the round trip without making a 60-person send feel stuck
 * (~36s, still well inside Vercel's ~300s Fluid Compute budget).
 */
export const DEFAULT_SEND_INTERVAL_MS = 600;

function configuredInterval(): number {
  const raw = process.env.RR_EMAIL_MIN_INTERVAL_MS;
  if (!raw) return DEFAULT_SEND_INTERVAL_MS;
  const value = Number(raw);
  // A malformed value must not silently disable pacing.
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SEND_INTERVAL_MS;
}

/**
 * A pacer with its own clock, so tests drive it without sleeping and the
 * production path has exactly one place that decides "how long until the next
 * send is allowed".
 */
export interface Pacer {
  /** Resolves when the next send may proceed. */
  wait(): Promise<void>;
  /** Milliseconds this pacer has spent waiting — for the run log. */
  waited(): number;
}

export interface PacerOptions {
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createPacer(options: PacerOptions = {}): Pacer {
  const interval = options.intervalMs ?? configuredInterval();
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastSendAt: number | null = null;
  let totalWaited = 0;

  return {
    async wait() {
      if (interval <= 0) return;
      const current = now();
      // The first send never waits — pacing is about the gap between sends,
      // and delaying the first one just makes every blast feel broken.
      if (lastSendAt !== null) {
        const elapsed = current - lastSendAt;
        const remaining = interval - elapsed;
        if (remaining > 0) {
          totalWaited += remaining;
          await sleep(remaining);
        }
      }
      lastSendAt = now();
    },
    waited() {
      return totalWaited;
    },
  };
}

/**
 * How long a send of `count` recipients will take at the configured pace.
 * Used to warn staff BEFORE they press the button, rather than leaving them
 * watching a spinner and wondering whether it died.
 */
export function estimateSendSeconds(count: number): number {
  if (count <= 1) return 0;
  return Math.round(((count - 1) * configuredInterval()) / 1000);
}

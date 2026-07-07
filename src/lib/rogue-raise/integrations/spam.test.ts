import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getSpamGuard } from "@/lib/rogue-raise/integrations/spam";

// Deterministic secret so issued signatures verify within the same process.
beforeAll(() => {
  process.env.RR_SPAM_SECRET = "test-spam-secret";
});

const guard = getSpamGuard();
const T0 = 1_700_000_000_000; // fixed epoch base for readable elapsed math.

describe("dev spam guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a singleton from getSpamGuard()", () => {
    expect(getSpamGuard()).toBe(getSpamGuard());
  });

  it("verifies a genuine challenge once the minimum time has elapsed", () => {
    vi.setSystemTime(T0);
    const challenge = guard.issueChallenge();

    vi.setSystemTime(T0 + 4_000); // 4s later -> above the 3s floor.
    const result = guard.verify({
      honeypot: "",
      renderedAt: challenge.renderedAt,
      sig: challenge.sig,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a submission that arrives too fast (< 3s)", () => {
    vi.setSystemTime(T0);
    const challenge = guard.issueChallenge();

    vi.setSystemTime(T0 + 1_000); // only 1s -> almost certainly a bot.
    const result = guard.verify({
      honeypot: "",
      renderedAt: challenge.renderedAt,
      sig: challenge.sig,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_fast");
  });

  it("rejects a tampered signature", () => {
    vi.setSystemTime(T0);
    const challenge = guard.issueChallenge();

    vi.setSystemTime(T0 + 4_000);
    const tampered = challenge.sig.slice(0, -1) + (challenge.sig.endsWith("0") ? "1" : "0");
    const result = guard.verify({
      honeypot: "",
      renderedAt: challenge.renderedAt,
      sig: tampered,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects an expired challenge (> 1h old)", () => {
    vi.setSystemTime(T0);
    const challenge = guard.issueChallenge();

    vi.setSystemTime(T0 + 60 * 60 * 1_000 + 1); // 1h + 1ms -> stale replay.
    const result = guard.verify({
      honeypot: "",
      renderedAt: challenge.renderedAt,
      sig: challenge.sig,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_old");
  });

  it("rejects a non-empty honeypot before anything else", () => {
    vi.setSystemTime(T0);
    const challenge = guard.issueChallenge();

    vi.setSystemTime(T0 + 4_000); // otherwise-valid timing.
    const result = guard.verify({
      honeypot: "i-am-a-bot",
      renderedAt: challenge.renderedAt,
      sig: challenge.sig,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("honeypot_filled");
  });

  it("rejects a missing challenge (empty renderedAt/sig)", () => {
    const result = guard.verify({ honeypot: "", renderedAt: "", sig: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_challenge");
  });
});

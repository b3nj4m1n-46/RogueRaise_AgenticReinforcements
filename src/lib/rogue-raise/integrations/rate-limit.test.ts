import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPacer,
  DEFAULT_SEND_INTERVAL_MS,
  estimateSendSeconds,
} from "./rate-limit";

/** A fake clock, so pacing is tested without anyone waiting for it. */
function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    slept,
  };
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createPacer", () => {
  it("does not delay the first send", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ intervalMs: 600, ...clock });
    await pacer.wait();
    // Delaying the first one just makes every blast feel broken.
    expect(clock.slept).toEqual([]);
    expect(pacer.waited()).toBe(0);
  });

  it("waits the full interval between back-to-back sends", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ intervalMs: 600, ...clock });
    await pacer.wait();
    await pacer.wait();
    await pacer.wait();
    expect(clock.slept).toEqual([600, 600]);
    expect(pacer.waited()).toBe(1200);
  });

  it("waits only the REMAINDER when the caller was already slow", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ intervalMs: 600, ...clock });
    await pacer.wait();
    // The send itself took 400ms; only 200ms of pacing is owed.
    clock.advance(400);
    await pacer.wait();
    expect(clock.slept).toEqual([200]);
  });

  it("does not wait at all when the send took longer than the interval", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ intervalMs: 600, ...clock });
    await pacer.wait();
    clock.advance(5_000);
    await pacer.wait();
    expect(clock.slept).toEqual([]);
  });

  it("is a no-op when the interval is zero", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ intervalMs: 0, ...clock });
    await pacer.wait();
    await pacer.wait();
    expect(clock.slept).toEqual([]);
  });

  it("reads the interval from the environment", async () => {
    process.env.RR_EMAIL_MIN_INTERVAL_MS = "100";
    const clock = fakeClock();
    const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
    await pacer.wait();
    await pacer.wait();
    expect(clock.slept).toEqual([100]);
  });

  it("falls back to the default rather than disabling pacing on a bad value", async () => {
    // A typo'd env var must not silently turn off rate limiting.
    process.env.RR_EMAIL_MIN_INTERVAL_MS = "six hundred";
    const clock = fakeClock();
    const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
    await pacer.wait();
    await pacer.wait();
    expect(clock.slept).toEqual([DEFAULT_SEND_INTERVAL_MS]);
  });

  it("rejects a negative interval the same way", async () => {
    process.env.RR_EMAIL_MIN_INTERVAL_MS = "-1000";
    const clock = fakeClock();
    const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
    await pacer.wait();
    await pacer.wait();
    expect(clock.slept).toEqual([DEFAULT_SEND_INTERVAL_MS]);
  });
});

describe("estimateSendSeconds", () => {
  // The suite disables pacing globally (see vitest.setup.ts); these cases are
  // about the DEFAULT, so they clear that first.
  beforeEach(() => {
    delete process.env.RR_EMAIL_MIN_INTERVAL_MS;
  });

  it("is zero for nobody or one recipient", () => {
    expect(estimateSendSeconds(0)).toBe(0);
    expect(estimateSendSeconds(1)).toBe(0);
  });

  it("counts the gaps, not the sends", () => {
    // 10 recipients means 9 waits.
    expect(estimateSendSeconds(10)).toBe(
      Math.round((9 * DEFAULT_SEND_INTERVAL_MS) / 1000),
    );
  });

  it("stays inside a Vercel function budget at realistic scale", () => {
    // 100 participants is far larger than a Rogue Raise; if THIS exceeded the
    // ~300s timeout, the inline loop would need replacing with a real queue.
    expect(estimateSendSeconds(100)).toBeLessThan(120);
  });
});

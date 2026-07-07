/**
 * Unit tests for the magic-link token helper (story 2). Pure crypto/URL logic —
 * no DB, no request context. The signing secret is read from env AT CALL TIME
 * (see getMagicLinkSecret), so the "different secret → different hash" case mutates
 * process.env within the test and restores it afterward.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  buildIntakeInviteUrl,
  generateMagicToken,
  hashMagicToken,
  MAGIC_LINK_TTL_MS,
  SPONSOR_POC_ROLE,
} from "./magic-link";

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("SPONSOR_POC_ROLE / MAGIC_LINK_TTL_MS constants", () => {
  it("SPONSOR_POC_ROLE is the magic_link_role enum value", () => {
    expect(SPONSOR_POC_ROLE).toBe("sponsor_poc");
  });

  it("MAGIC_LINK_TTL_MS is exactly 14 days in ms", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(MAGIC_LINK_TTL_MS).toBe(1_209_600_000);
  });
});

describe("generateMagicToken", () => {
  it("produces a URL-safe base64url raw token (no +, /, or = padding)", () => {
    const { raw } = generateMagicToken();
    expect(raw).toMatch(BASE64URL);
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");
    // randomBytes(32) → 43 base64url chars (no padding).
    expect(raw.length).toBe(43);
  });

  it("returns a 64-hex hash that matches hashMagicToken(raw) (determinism)", () => {
    const { raw, hash } = generateMagicToken();
    expect(hash).toMatch(HEX64);
    expect(hashMagicToken(raw)).toBe(hash);
    // Idempotent: hashing the same raw twice yields the same digest.
    expect(hashMagicToken(raw)).toBe(hashMagicToken(raw));
  });

  it("yields a unique raw + hash on every call", () => {
    const raws = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { raw, hash } = generateMagicToken();
      raws.add(raw);
      hashes.add(hash);
    }
    expect(raws.size).toBe(200);
    expect(hashes.size).toBe(200);
  });
});

describe("hashMagicToken secret sensitivity", () => {
  const original = process.env.RR_MAGIC_LINK_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.RR_MAGIC_LINK_SECRET;
    else process.env.RR_MAGIC_LINK_SECRET = original;
  });

  it("produces a different hash for the same raw under a different secret", () => {
    const raw = "constant-raw-token-value";

    process.env.RR_MAGIC_LINK_SECRET = "secret-one";
    const hashOne = hashMagicToken(raw);

    process.env.RR_MAGIC_LINK_SECRET = "secret-two";
    const hashTwo = hashMagicToken(raw);

    expect(hashOne).toMatch(HEX64);
    expect(hashTwo).toMatch(HEX64);
    expect(hashOne).not.toBe(hashTwo);

    // Same secret again reproduces the first digest (env read at call time).
    process.env.RR_MAGIC_LINK_SECRET = "secret-one";
    expect(hashMagicToken(raw)).toBe(hashOne);
  });
});

describe("buildIntakeInviteUrl", () => {
  const original = process.env.BETTER_AUTH_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = original;
  });

  it("builds `${BETTER_AUTH_URL}/sponsor/intake/<eventId>?token=<raw>`", () => {
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const eventId = "11111111-2222-3333-4444-555555555555";
    const raw = "abc-DEF_123";
    expect(buildIntakeInviteUrl(eventId, raw)).toBe(
      `http://localhost:3000/sponsor/intake/${eventId}?token=${raw}`,
    );
  });

  it("strips trailing slashes from the base", () => {
    process.env.BETTER_AUTH_URL = "https://app.example.test///";
    const eventId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(buildIntakeInviteUrl(eventId, "tok")).toBe(
      `https://app.example.test/sponsor/intake/${eventId}?token=tok`,
    );
  });

  it("round-trips a real generated base64url token through the URL parser", () => {
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const eventId = "99999999-8888-7777-6666-555555555555";
    const { raw } = generateMagicToken();
    const url = new URL(buildIntakeInviteUrl(eventId, raw));
    expect(url.pathname).toBe(`/sponsor/intake/${eventId}`);
    // base64url is URL-safe, so the token survives verbatim (no re-encoding).
    expect(url.searchParams.get("token")).toBe(raw);
  });
});

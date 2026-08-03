/**
 * The admin authorization boundary (PRD §9, §12).
 *
 * These are the tests that matter most in the repository: everything else
 * decides what staff *see*, and this decides who counts as staff. Each case is
 * written from the attacker's side — what does an unauthenticated caller,
 * a signed-in non-admin, or a banned former admin get?
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, headersMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: headersMock }));
// Mocked WHOLE, not partially: the real module constructs the Better Auth
// instance at import time, which needs a database connection this suite has no
// business requiring.
vi.mock("../integrations/auth", () => ({
  ADMIN_ROLE: "admin",
  getAuth: () => ({ api: { getSession: getSessionMock } }),
  isAuthConfigured: () =>
    Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL),
}));

import {
  adminActor,
  adminFailureMessage,
  checkAdmin,
  DEV_ADMIN,
  isDevOpen,
  NotAdminError,
  requireAdmin,
} from "./guard";

const REAL_ADMIN = {
  id: "usr_1",
  email: "staff@whiterabbitashland.com",
  name: "WR Staff",
  role: "admin",
  banned: false,
};

/** Restored after each test so one case can't leak into the next. */
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  getSessionMock.mockReset();
  headersMock.mockReset().mockResolvedValue(new Headers());
  process.env.RR_ADMIN_DEV_OPEN = "";
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isDevOpen", () => {
  it("is off unless explicitly opted into", () => {
    expect(isDevOpen()).toBe(false);
    process.env.RR_ADMIN_DEV_OPEN = "false";
    expect(isDevOpen()).toBe(false);
    process.env.RR_ADMIN_DEV_OPEN = "1";
    // Only the exact string "true" — a truthy-looking value is not consent.
    expect(isDevOpen()).toBe(false);
  });

  it("is on when opted into outside production", () => {
    process.env.RR_ADMIN_DEV_OPEN = "true";
    expect(isDevOpen()).toBe(true);
  });

  it("is REFUSED in production even when the variable says true", () => {
    // A stray env var must not be able to open the console in production.
    vi.stubEnv("NODE_ENV", "production");
    process.env.RR_ADMIN_DEV_OPEN = "true";
    expect(isDevOpen()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("checkAdmin", () => {
  it("refuses when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await checkAdmin()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("refuses a signed-in user who is not an admin", async () => {
    getSessionMock.mockResolvedValue({
      user: { ...REAL_ADMIN, role: "user" },
    });
    expect(await checkAdmin()).toEqual({ ok: false, reason: "not_admin" });
  });

  it("refuses a user with no role at all", async () => {
    getSessionMock.mockResolvedValue({
      user: { ...REAL_ADMIN, role: null },
    });
    expect(await checkAdmin()).toEqual({ ok: false, reason: "not_admin" });
  });

  it("refuses a BANNED admin whose session predates the ban", async () => {
    // Better Auth blocks a banned user at sign-in; without this check their
    // existing session would outlive the ban.
    getSessionMock.mockResolvedValue({
      user: { ...REAL_ADMIN, banned: true },
    });
    expect(await checkAdmin()).toEqual({ ok: false, reason: "not_admin" });
  });

  it("admits a real admin", async () => {
    getSessionMock.mockResolvedValue({ user: REAL_ADMIN });
    expect(await checkAdmin()).toEqual({
      ok: true,
      admin: {
        userId: "usr_1",
        email: "staff@whiterabbitashland.com",
        name: "WR Staff",
      },
    });
  });

  it("FAILS CLOSED when the session lookup throws", async () => {
    // A database blip must lock staff out, never let the public in.
    getSessionMock.mockRejectedValue(new Error("connection reset"));
    expect(await checkAdmin()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("refuses when auth isn't configured, without consulting a session", async () => {
    process.env.BETTER_AUTH_SECRET = "";
    process.env.BETTER_AUTH_URL = "";
    expect(await checkAdmin()).toEqual({ ok: false, reason: "unconfigured" });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("short-circuits to the dev identity when dev-open, without a session", async () => {
    process.env.RR_ADMIN_DEV_OPEN = "true";
    expect(await checkAdmin()).toEqual({ ok: true, admin: DEV_ADMIN });
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  it("returns the identity for an admin", async () => {
    getSessionMock.mockResolvedValue({ user: REAL_ADMIN });
    await expect(requireAdmin()).resolves.toMatchObject({ userId: "usr_1" });
  });

  it("THROWS rather than returning a flag", async () => {
    // A forgotten `if` on a boolean would be an authorization bypass; a
    // forgotten `await` on this is a crash, which is the safer failure.
    getSessionMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotAdminError);
  });

  it("never leaks why in the thrown message", async () => {
    getSessionMock.mockResolvedValue({ user: { ...REAL_ADMIN, role: "user" } });
    await expect(requireAdmin()).rejects.toThrow(
      "This action requires a signed-in White Rabbit admin.",
    );
  });
});

describe("adminActor", () => {
  it("names the individual admin for the audit log", () => {
    expect(adminActor({ userId: "usr_9", email: "a@b.c", name: "A" })).toBe(
      "wr-admin:usr_9",
    );
  });

  it("keeps the historic actor string for dev-open runs", () => {
    // So local rows stay comparable with everything written before auth landed.
    expect(adminActor(DEV_ADMIN)).toBe("wr-admin");
  });
});

describe("adminFailureMessage", () => {
  it("tells a signed-out admin their work wasn't lost", async () => {
    expect(adminFailureMessage("unauthenticated")).toContain("nothing was changed");
  });

  it("has a message for every failure reason", () => {
    for (const reason of ["unauthenticated", "not_admin", "unconfigured"] as const) {
      expect(adminFailureMessage(reason).length).toBeGreaterThan(10);
    }
  });
});

/**
 * Auth seam (PRD §12). Better Auth over the shared Drizzle/Postgres DB, with the
 * **`admin` plugin** for WR staff.
 *
 * Two decisions worth understanding before changing anything here:
 *
 * **1. Only WR Admin gets a Better Auth session.** The PRD also lists the
 * `magicLink` plugin for the four external roles, but this app already has a
 * complete, event-scoped magic-link implementation of its own
 * (`rogue_raise.magic_link_tokens` + `access/redeem.ts`) that Better Auth's
 * plugin does not replace: ours scopes a token to one **event** and one **role**
 * and audits it, which is the property the PRD's own scoping AC turns on
 * ("a Judge for Event A cannot read Event B"). Swapping it for a session would
 * lose that scoping and gain nothing. The migration path is written down in
 * HANDOFF.md; it is a deliberate deferral, not an oversight.
 *
 * **2. This module fails closed.** `getAuth()` throws when Better Auth is not
 * configured, and the admin guard treats a throw as "not signed in". A
 * misconfigured deployment therefore locks staff out rather than letting the
 * public in.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";

import { db } from "../db";
import { authSchema } from "../db/auth-schema";

export type MagicLinkRole =
  | "sponsor_poc"
  | "judge"
  | "participant"
  | "stakeholder";

/** The Better Auth role that opens `/admin/*`. */
export const ADMIN_ROLE = "admin" as const;

export interface AuthConfig {
  secret: string;
  baseUrl: string;
}

export function getAuthConfig(): AuthConfig {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!secret || !baseUrl) {
    throw new Error(
      "Better Auth not configured (set BETTER_AUTH_SECRET and BETTER_AUTH_URL).",
    );
  }
  return { secret, baseUrl };
}

/** True when the environment can support a real sign-in. */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL);
}

/**
 * Built in its own function so the instance type is INFERRED from the plugin
 * list. Typing it as `ReturnType<typeof betterAuth>` widens to the base options
 * and silently drops the admin plugin's endpoints and its `role`/`banned`
 * fields — which is exactly the type information the guard below depends on.
 */
function createAuth() {
  const config = getAuthConfig();

  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    // Email + password only. WR staff are a handful of people who already have
    // accounts on the main site; social providers would be a second identity
    // store, which §12 explicitly forbids.
    emailAndPassword: {
      enabled: true,
      // Sign-up is closed: staff accounts are created deliberately, by an
      // existing admin or the seed script. An open sign-up form on a console
      // that can email every participant is not a thing to ship.
      disableSignUp: true,
    },
    // The admin plugin supplies `role`, `banned`, `banReason`, `banExpires` —
    // declaring `role` again as an additional field would conflict with it.
    //
    // `nextCookies()` MUST be last. Calling `signInEmail` from a Server Action
    // returns the session but writes no cookie on its own; this plugin forwards
    // Better Auth's Set-Cookie through Next's `cookies()` API. Without it
    // sign-in silently "succeeds" and every subsequent request is anonymous —
    // which is exactly how it failed the first time.
    plugins: [
      adminPlugin({ defaultRole: "user", adminRoles: [ADMIN_ROLE] }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

/** Test seam — drops the cached instance so env changes take effect. */
export function resetAuth(): void {
  instance = undefined;
}

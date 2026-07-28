/**
 * The WR Admin authorization check (PRD §9, §12).
 *
 * DELIBERATELY NOT a `"use server"` module — exports there become POST
 * endpoints, and an authorization helper is the last thing that should be
 * callable from the outside.
 *
 * **Every one of these fails closed.** A missing session, a missing role, a
 * banned account, an unconfigured environment, or a thrown error all resolve to
 * "not an admin". The one thing this must never do is treat an error as
 * permission.
 *
 * Middleware is NOT the security boundary here — it can't be, because a Server
 * Action is reachable without ever passing through a matched route. It is a
 * fast rejection for page loads; `requireAdmin()` at the top of each privileged
 * action is what actually holds.
 */
import { headers } from "next/headers";

import { ADMIN_ROLE, getAuth, isAuthConfigured } from "../integrations/auth";

export interface AdminIdentity {
  userId: string;
  email: string;
  name: string;
}

export type AdminCheck =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; reason: "unauthenticated" | "not_admin" | "unconfigured" };

/**
 * The escape hatch for local development, and the only way `/admin` opens
 * without a real account. It is checked in exactly one place so there is one
 * thing to grep for, and it is refused in production regardless of what the
 * variable says — a stray env var must not be able to open the console.
 */
export function isDevOpen(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RR_ADMIN_DEV_OPEN === "true"
  );
}

/** The identity used for audit rows when the console is dev-open. */
export const DEV_ADMIN: AdminIdentity = {
  userId: "dev",
  email: "dev@localhost",
  name: "Local dev",
};

export async function checkAdmin(): Promise<AdminCheck> {
  if (isDevOpen()) return { ok: true, admin: DEV_ADMIN };
  if (!isAuthConfigured()) return { ok: false, reason: "unconfigured" };

  try {
    const session = await getAuth().api.getSession({
      headers: await headers(),
    });
    if (!session?.user) return { ok: false, reason: "unauthenticated" };

    const user = session.user;
    // A banned admin is not an admin. Better Auth enforces this at sign-in, but
    // an existing session outlives the ban without this check.
    if (user.banned) return { ok: false, reason: "not_admin" };
    if (user.role !== ADMIN_ROLE) return { ok: false, reason: "not_admin" };

    return {
      ok: true,
      admin: { userId: user.id, email: user.email, name: user.name },
    };
  } catch (err) {
    // A database blip or a misconfigured secret must lock staff out, never let
    // the public in.
    console.error("[admin] session check failed", err);
    return { ok: false, reason: "unauthenticated" };
  }
}

export type AdminFailure = Extract<AdminCheck, { ok: false }>["reason"];

export class NotAdminError extends Error {
  constructor(readonly reason: AdminFailure) {
    super("This action requires a signed-in White Rabbit admin.");
    this.name = "NotAdminError";
  }
}

/**
 * Call at the top of every privileged server action. Throws rather than
 * returning a flag so a forgotten `if` can't become an authorization bypass —
 * the failure mode of a missing check should be a crash, not a silent allow.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const check = await checkAdmin();
  if (!check.ok) throw new NotAdminError(check.reason);
  return check.admin;
}

/**
 * The result-returning form, for actions whose UI already renders an error
 * string. `requireAdmin()` throwing is the right default — a forgotten check
 * should crash rather than silently allow — but an action that returns
 * `{ ok, error }` can say "you're signed out" far better than a 500 can.
 */
export async function adminOrError(): Promise<
  { ok: true; admin: AdminIdentity } | { ok: false; error: string }
> {
  const check = await checkAdmin();
  if (check.ok) return check;
  return { ok: false, error: adminFailureMessage(check.reason) };
}

export function adminFailureMessage(reason: AdminFailure): string {
  switch (reason) {
    case "unauthenticated":
      return "You've been signed out. Sign in again and retry — nothing was changed.";
    case "not_admin":
      return "Your account isn't a White Rabbit admin, so this action was refused.";
    case "unconfigured":
      return "Authentication isn't configured in this environment, so privileged actions are refused.";
  }
}

/** The `actor` string written into `audit_log` for this admin. */
export function adminActor(admin: AdminIdentity): string {
  return admin.userId === DEV_ADMIN.userId
    ? "wr-admin"
    : `wr-admin:${admin.userId}`;
}

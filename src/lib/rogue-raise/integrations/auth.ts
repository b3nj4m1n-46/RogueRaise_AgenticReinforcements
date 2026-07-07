/**
 * Auth seam. Built on Better Auth (WR's existing auth layer) — `magicLink` plugin
 * for external roles (Sponsor POC, Judge, Participant, Stakeholder) and `admin`
 * plugin for WR Admin, over the shared Drizzle/Postgres DB (PRD §12).
 *
 * Role/event scoping is enforced in server logic on top of Better Auth sessions:
 * a Judge for Event A must never read Event B. The `magic_link_tokens` table
 * records event/role scope + hashed token for our own scoping/audit.
 *
 * The concrete Better Auth instance is wired in with the first auth-gated story.
 */
export type MagicLinkRole =
  | "sponsor_poc"
  | "judge"
  | "participant"
  | "stakeholder";

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

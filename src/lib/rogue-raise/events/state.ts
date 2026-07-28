/**
 * UI contract for the admin event actions. Plain module — a `"use server"` file
 * may only export async functions (see CLAUDE.md).
 */

export interface AdminEventState {
  ok: boolean;
  /** Rendered in the success live region. */
  notice?: string;
  /** Rendered in the error live region. */
  formError?: string;
  /** Bumped every result so an identical repeated message still re-announces. */
  version?: number;
}

export const initialAdminEventState: AdminEventState = { ok: true };

/**
 * Audit actor for console actions. Still a placeholder: `/admin/*` has no
 * per-person identity until the Better Auth `admin` story lands, and the same
 * constant is used by the sponsor curation actions.
 */
export const ACTOR_WR_ADMIN = "wr-admin";

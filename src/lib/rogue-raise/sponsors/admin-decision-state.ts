/**
 * Non-async values + types shared by the admin decision actions.
 *
 * These MUST live OUTSIDE `admin-actions.ts`. That module carries the module-
 * level `"use server"` directive, and Next only permits a `"use server"` file to
 * export async functions — exporting the actor constant or the initial-state
 * object from there throws at runtime:
 *   A "use server" file can only export async functions, found object.
 * Keeping them here (a plain module) lets `admin-actions.ts` stay async-only
 * while the client island + tests import the state shape from a safe location.
 */

/** Audit actor placeholder until per-admin identity arrives (Better Auth story). */
/**
 * `useActionState` state. The actions only ever RETURN a failure shape — success
 * is a PRG redirect to `/admin/sponsors`. Absent errors == idle initial state.
 */
export type AdminDecisionState = {
  ok: false;
  formError?: string;
  fieldErrors?: Record<string, string[]>;
};

/** Initial state for `useActionState(approve|rejectSponsorApplication, …)`. */
export const initialAdminDecisionState: AdminDecisionState = { ok: false };

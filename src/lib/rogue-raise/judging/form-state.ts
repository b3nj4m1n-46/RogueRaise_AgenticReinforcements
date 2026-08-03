/**
 * UI contract for the scorecard. Plain module — a `"use server"` file may only
 * export async functions (see CLAUDE.md).
 */
export interface ScorecardState {
  ok: boolean;
  /** Which submission this result belongs to, so one form's error can't paint another's. */
  submissionId?: string;
  /** "draft" | "final" — what actually got saved. */
  saved?: "draft" | "final";
  formError?: string;
  /** `criterionId → message` plus a `notes` key. */
  fieldErrors?: Record<string, string>;
  version?: number;
}

export const initialScorecardState: ScorecardState = { ok: false };

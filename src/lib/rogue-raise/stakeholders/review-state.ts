/**
 * UI contract for the stakeholder review form. Plain module — a `"use server"`
 * file may only export async functions (see CLAUDE.md).
 */
export interface ReviewFormState {
  ok: boolean;
  /** Which asset this result belongs to, so one form can't paint another's. */
  assetId?: string;
  formError?: string;
  version?: number;
}

export const initialReviewFormState: ReviewFormState = { ok: false };

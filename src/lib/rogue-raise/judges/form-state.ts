/**
 * UI contract for the judge background form. Plain module — a `"use server"`
 * file may only export async functions (see CLAUDE.md).
 */
export interface JudgeFormState {
  status: "idle" | "saved" | "error";
  savedAt?: string;
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  /** True once the judge has completed their profile at least once. */
  complete?: boolean;
  version?: number;
}

export const initialJudgeFormState: JudgeFormState = { status: "idle" };

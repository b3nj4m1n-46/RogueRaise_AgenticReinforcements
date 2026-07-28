/**
 * UI contract for the submission form. Plain module — a `"use server"` file may
 * only export async functions (see CLAUDE.md).
 */
export interface SubmissionFormValues {
  teamName: string;
  projectSummary: string;
  repoUrl: string;
  pitchMaterialsUrl: string;
  members: { name: string; email: string }[];
}

export interface SubmissionFormState {
  ok: boolean;
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  values?: SubmissionFormValues;
  version?: number;
}

export const initialSubmissionFormState: SubmissionFormState = { ok: false };

/**
 * UI contract for participant registration. Plain module — a `"use server"`
 * file may only export async functions (see CLAUDE.md).
 */
export interface RegistrationValues {
  firstName: string;
  lastName: string;
  email: string;
  githubUsername: string;
}

export interface RegistrationState {
  ok: false;
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  values?: RegistrationValues;
}

export const initialRegistrationState: RegistrationState = { ok: false };

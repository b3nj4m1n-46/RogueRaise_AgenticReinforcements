/**
 * UI contract for the admin sign-in form. Plain module — a `"use server"` file
 * may only export async functions (see CLAUDE.md).
 */
export interface SignInState {
  ok: boolean;
  error?: string;
  email?: string;
  version?: number;
}

export const initialSignInState: SignInState = { ok: false };

/**
 * UI contract for the intake actions. Lives in a PLAIN module because a
 * `"use server"` module may only export async functions — a value or type-only
 * export there throws at runtime on Next 16 (see CLAUDE.md).
 */

/** Where the last attempted save got to. `idle` is the never-saved initial state. */
export type IntakeSaveStatus = "idle" | "saved" | "error";

/** Keyed by dot-path (`judges.0.email`, `stakeholderTechStack`, …). */
export type IntakeFieldErrors = Record<string, string[]>;

export interface IntakeFormState {
  status: IntakeSaveStatus;
  /** ISO timestamp of the last successful save — rendered as "Saved at 4:12 PM". */
  savedAt?: string;
  /** Whole-form problem (expired link, wrong phase, save failed). */
  formError?: string;
  fieldErrors?: IntakeFieldErrors;
  /** Transient confirmation, e.g. after adding or removing a file. */
  notice?: string;
  /** True when this save/upload/removal left the intake complete. */
  complete?: boolean;
  /** True only on the save that FLIPPED the event to `intake_complete`. */
  justCompleted?: boolean;
  /**
   * Bumped on every action result so the client can re-announce an identical
   * message (a repeated failure must still move focus and re-fire the live region).
   */
  version?: number;
}

export const initialIntakeFormState: IntakeFormState = { status: "idle" };

/** The POC-facing copy for each way a magic link can fail. Never leaks internals. */
export const INTAKE_ACCESS_MESSAGES: Record<string, string> = {
  invalid:
    "This link isn't valid. Please use the most recent link we emailed you, or reply to that email and we'll send a new one.",
  expired:
    "This link has expired. Reply to the approval email we sent and we'll issue you a fresh one.",
  revoked:
    "This link has been turned off. Reply to the approval email we sent and we'll issue you a new one.",
  wrong_event:
    "This link doesn't open this Rogue Raise. Please use the link from the email about this event.",
  wrong_role:
    "This link doesn't open the sponsor intake form. Please use the link from your approval email.",
};

export function intakeAccessMessage(reason: string): string {
  return INTAKE_ACCESS_MESSAGES[reason] ?? INTAKE_ACCESS_MESSAGES.invalid;
}

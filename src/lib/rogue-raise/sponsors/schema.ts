/**
 * Shared sponsor sign-up validation schema — the single source of truth imported
 * by BOTH the client form (UX-only validation) and the server action (mandatory
 * re-validation). Fields with hard caps: the DB columns are unbounded Postgres
 * `text`, so these length limits are a DoS guard, not a storage constraint.
 *
 * zod v4 APIs (`z.email()` top-level, `z.flattenError`) — do not port to v3 forms.
 */
import { z } from "zod";

/** E.164 phone: leading `+`, first digit 1-9, then 6-14 more digits. */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Amount as a numeric STRING to preserve `numeric(12,2)` precision (never a JS float). */
export const AMOUNT_REGEX = /^\d{1,10}(\.\d{1,2})?$/;

export const stakeholderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  email: z.email("Enter a valid email").max(254, "Email is too long"),
  // Phone required per PRD §5.1; the DB column stays nullable (no migration).
  phone: z
    .string()
    .trim()
    .regex(E164_REGEX, "Enter a phone in E.164 format, e.g. +15415551234"),
});

export const financialCommitmentSchema = z
  .object({
    // `null` only when the POC chose "prefer to discuss".
    amount: z
      .string()
      .regex(AMOUNT_REGEX, "Enter a whole or two-decimal amount, e.g. 5000 or 5000.00")
      .nullable(),
    note: z.string().trim().max(2000, "Note is too long").optional(),
    toDiscuss: z.boolean(),
  })
  .refine(
    (fc) => (fc.toDiscuss ? fc.amount === null : fc.amount !== null),
    {
      // XOR: either commit an amount OR choose to discuss — never both, never neither.
      error: "Enter an amount or choose to discuss it later",
      path: ["amount"],
    },
  );

export const sponsorApplicationSchema = z.object({
  orgName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(200, "Organization name is too long"),
  pocName: z
    .string()
    .trim()
    .min(1, "Your name is required")
    .max(200, "Name is too long"),
  pocEmail: z.email("Enter a valid email").max(254, "Email is too long"),
  pocPhone: z
    .string()
    .trim()
    .regex(E164_REGEX, "Enter a phone in E.164 format, e.g. +15415551234"),
  painPoints: z
    .string()
    .trim()
    .min(1, "Tell us about the problem you're facing")
    .max(5000, "Please keep this under 5000 characters"),
  goalsNeeds: z
    .string()
    .trim()
    .min(1, "Tell us about your goals and needs")
    .max(5000, "Please keep this under 5000 characters"),
  financialCommitment: financialCommitmentSchema,
  stakeholders: z
    .array(stakeholderSchema)
    .min(1, "Add at least one stakeholder")
    .max(20, "You can add up to 20 stakeholders"),
});

/** Fully-validated, parsed application (server-side shape after `safeParse`). */
export type SponsorApplicationInput = z.infer<typeof sponsorApplicationSchema>;
export type StakeholderInput = z.infer<typeof stakeholderSchema>;

// ---------------------------------------------------------------------------
// Admin curation (story 2) — decision schema + pure transition guards.
//
// These are appended, never modifying the exports above (63 tests depend on
// them). The status literals mirror the `sponsor_app_status` / `event_status`
// Postgres enums in db/schema.ts; kept as local literals so this module stays a
// pure, DB-free schema importable by both client and server.
// ---------------------------------------------------------------------------

/** WR Admin's decision on an application. */
export type AdminDecision = "approve" | "reject";

/** Subset of `sponsor_app_status` this module reasons about. */
export type SponsorAppStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected";

/** Subset of `event_status` an admin decision transitions an event to. */
export type DecidedEventStatus = "intake_pending" | "rejected";

/** Statuses on which Approve/Reject is still valid (idempotency window). */
export const ACTIONABLE_APP_STATUSES = ["submitted", "under_review"] as const;

/**
 * Optional internal note captured with a decision. `trim`, capped at 2000 (DoS
 * guard, not a storage limit — the column is unbounded `text`), and optional so
 * an empty note is valid. Never echoed into POC-facing email.
 */
export const adminDecisionSchema = z.object({
  note: z.string().trim().max(2000, "Note is too long").optional(),
});
export type AdminDecisionInput = z.infer<typeof adminDecisionSchema>;

/** True when an application can still be approved/rejected. */
export function isActionableAppStatus(status: string): boolean {
  return (ACTIONABLE_APP_STATUSES as readonly string[]).includes(status);
}

/** Exhaustiveness guard — unreachable at runtime if the union is covered. */
function assertNever(value: never): never {
  throw new Error(`Unexpected decision: ${String(value)}`);
}

/**
 * Resolve the target application + event statuses for a decision. Approve goes
 * straight to `intake_pending` (no phantom committed `approved` state); reject is
 * terminal. Throws if `current` is not actionable — callers gate with
 * `isActionableAppStatus` first (the real enforcement is the row-locked guard in
 * the server action).
 */
export function allowedNextStatus(
  current: SponsorAppStatus,
  decision: AdminDecision,
): { appStatus: SponsorAppStatus; eventStatus: DecidedEventStatus } {
  if (!isActionableAppStatus(current)) {
    throw new Error(`Application in status "${current}" cannot be decided`);
  }
  switch (decision) {
    case "approve":
      return { appStatus: "approved", eventStatus: "intake_pending" };
    case "reject":
      return { appStatus: "rejected", eventStatus: "rejected" };
    default:
      return assertNever(decision);
  }
}

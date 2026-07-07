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

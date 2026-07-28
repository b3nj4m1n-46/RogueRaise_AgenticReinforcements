/**
 * Secondary-intake validation schema (PRD §5.2.2) — the single source of truth
 * imported by BOTH the client form (which uses it to decide whether an autosave
 * is worth attempting) and the server action (which re-validates, always).
 *
 * Autosave shapes the design: the intake is a DRAFT until every VITAL field is
 * present, so almost everything is optional. What the schema still enforces is
 * *shape* — a judge row that exists must have a name and a real email, a date
 * option must land on a Friday — because those become NOT NULL database rows.
 *
 * Blank rows are dropped, never rejected: `dropBlankRows` runs on both sides so
 * a half-typed row the user abandoned disappears identically everywhere.
 *
 * Length caps are DoS guards (the columns are unbounded `text`), not storage limits.
 */
import { z } from "zod";

import { AMOUNT_REGEX, E164_REGEX } from "../sponsors/schema";
import { isFridayDate, MAX_KICKOFF_HOUR, MIN_KICKOFF_HOUR } from "./schedule";

export { AMOUNT_REGEX, E164_REGEX };

/** Treat an all-whitespace string as "not provided" instead of a validation error. */
function optionalText(max: number, message?: string) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(max, message ?? `Please keep this under ${max} characters`)
      .optional(),
  );
}

// --- Collection caps (also enforced in the UI so the two never disagree) ----

export const MAX_JUDGES = 12;
export const MAX_CRITERIA = 12;
export const MAX_DATE_OPTIONS = 6;
export const MAX_TECH_SPONSORS = 12;
export const MAX_TECH_TAGS = 20;
export const MAX_LONG_TEXT = 20000;

// --- Judges ----------------------------------------------------------------

export const intakeJudgeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  email: z.email("Enter a valid email").max(254, "Email is too long"),
  phone: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .regex(E164_REGEX, "Enter a phone in E.164 format, e.g. +15415551234")
      .optional(),
  ),
});

// --- Evaluative criteria ----------------------------------------------------

/** Weight is a plain 0–100 relative number; `numeric(6,3)` keeps it exact. */
export const WEIGHT_REGEX = /^\d{1,3}(\.\d{1,3})?$/;

export const intakeCriterionSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give this criterion a short name")
    .max(200, "Name is too long"),
  description: optionalText(2000),
  weight: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .regex(WEIGHT_REGEX, "Enter a weight like 25 or 12.5")
      .refine((w) => Number(w) <= 100, "Weight can't exceed 100")
      .optional(),
  ),
});

// --- Date options (fixed schedule template, PRD §5.2.3) --------------------

export const intakeDateOptionSchema = z.object({
  /** Calendar date of the FRIDAY that anchors the weekend. */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .refine(isFridayDate, "Rogue Raise weekends start on a Friday"),
  kickoffHour: z
    .number()
    .int("Choose a kickoff time")
    .min(MIN_KICKOFF_HOUR, "Kickoff can't be earlier than noon")
    .max(MAX_KICKOFF_HOUR, "Kickoff can't be later than 8:00 PM"),
});

// --- Technical sponsors -----------------------------------------------------

export const TECH_SPONSOR_STATUSES = [
  "proposed",
  "contacted",
  "confirmed",
  "declined",
] as const;
export type TechSponsorStatus = (typeof TECH_SPONSOR_STATUSES)[number];

export const intakeTechSponsorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long"),
  /**
   * WHAT they provide (API credits, tokens, licences). Deliberately a
   * description — PRD §11 forbids storing secret material here, and the intake
   * copy says so out loud.
   */
  offering: optionalText(2000),
  contactName: optionalText(200),
  contactEmail: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.email("Enter a valid email").max(254, "Email is too long").optional(),
  ),
  status: z.enum(TECH_SPONSOR_STATUSES).default("proposed"),
});

// --- Awards budget ----------------------------------------------------------

export const intakeAwardsBudgetSchema = z.object({
  amount: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .regex(AMOUNT_REGEX, "Enter a whole or two-decimal amount, e.g. 1500 or 1500.00")
      .optional(),
  ),
  note: optionalText(2000),
});

// --- Whole draft ------------------------------------------------------------

export const intakeDraftSchema = z.object({
  judges: z.array(intakeJudgeSchema).max(MAX_JUDGES, `Up to ${MAX_JUDGES} judges`),
  criteria: z
    .array(intakeCriterionSchema)
    .max(MAX_CRITERIA, `Up to ${MAX_CRITERIA} criteria`),
  dateOptions: z
    .array(intakeDateOptionSchema)
    .max(MAX_DATE_OPTIONS, `Up to ${MAX_DATE_OPTIONS} weekend options`),
  techSponsors: z
    .array(intakeTechSponsorSchema)
    .max(MAX_TECH_SPONSORS, `Up to ${MAX_TECH_SPONSORS} technical sponsors`),
  awardsBudget: intakeAwardsBudgetSchema,
  supplementaryInfo: optionalText(MAX_LONG_TEXT),
  stakeholderTechStack: optionalText(MAX_LONG_TEXT),
  stakeholderTechTags: z
    .array(z.string().trim().min(1).max(40, "Tags are limited to 40 characters"))
    .max(MAX_TECH_TAGS, `Up to ${MAX_TECH_TAGS} tags`),
});

export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
export type IntakeJudge = z.infer<typeof intakeJudgeSchema>;
export type IntakeCriterion = z.infer<typeof intakeCriterionSchema>;
export type IntakeDateOption = z.infer<typeof intakeDateOptionSchema>;
export type IntakeTechSponsor = z.infer<typeof intakeTechSponsorSchema>;

/** A brand-new, entirely empty draft — the client's initial state and a test seed. */
export function emptyIntakeDraft(): IntakeDraft {
  return {
    judges: [],
    criteria: [],
    dateOptions: [],
    techSponsors: [],
    awardsBudget: {},
    supplementaryInfo: undefined,
    stakeholderTechStack: undefined,
    stakeholderTechTags: [],
  };
}

// --- Blank-row handling -----------------------------------------------------

/**
 * A row the user added but never filled in. Dropped silently on BOTH sides so a
 * forgotten empty row never becomes a validation error the user can't explain.
 */
export function isBlankRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) =>
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0),
  );
}

/** Drop blank rows from a repeatable collection, preserving order. */
export function dropBlankRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.filter((row) => !isBlankRow(row));
}

/** Split a comma/newline-separated tag entry into normalized, unique tags. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TECH_TAGS) break;
  }
  return tags;
}

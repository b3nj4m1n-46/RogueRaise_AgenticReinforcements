"use server";

/**
 * Public sponsor sign-up server action. Shaped for React `useActionState`:
 * `(prevState, formData) => nextState`. On success it PRG-redirects to
 * `/sponsor/thanks`; on failure it returns a re-render state that preserves the
 * submitted values and carries field/form errors.
 *
 * Trust boundary: the form is public and unauthenticated. Client-side zod is UX
 * only — THIS action re-validates everything, spam-checks first, and performs all
 * writes in a single transaction (org + application + event + stakeholders +
 * audit row) so a partial failure rolls the whole thing back.
 */
import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "../db";
import {
  auditLog,
  events,
  organizations,
  sponsorApplications,
  stakeholders,
} from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { getSpamGuard } from "../integrations/spam";
import { buildAdminNotifyEmail, buildPocAckEmail } from "./emails";
import { slugify } from "./slug";
import { sponsorApplicationSchema } from "./schema";

// --- UI contract types -----------------------------------------------------

export type SponsorFinancialMode = "amount" | "discuss";

/** Raw entered values, echoed back on error so nothing is retyped. */
export interface SponsorFormValues {
  orgName: string;
  pocName: string;
  pocEmail: string;
  pocPhone: string;
  painPoints: string;
  goalsNeeds: string;
  financialMode: SponsorFinancialMode;
  financialAmount: string;
  financialNote: string;
  stakeholders: { name: string; email: string; phone: string }[];
}

/** Keyed by dot-path (`orgName`, `financialCommitment.amount`, `stakeholders.0.email`). */
export type SponsorFieldErrors = Record<string, string[]>;

/**
 * `useActionState` state. The action only ever RETURNS a failure/idle shape —
 * success is a redirect. `formError`/`fieldErrors` absent == idle initial state.
 */
export interface SponsorFormState {
  ok: false;
  formError?: string;
  fieldErrors?: SponsorFieldErrors;
  values?: SponsorFormValues;
}

/** Initial state for `useActionState(createSponsorApplication, initialSponsorFormState)`. */
export const initialSponsorFormState: SponsorFormState = { ok: false };

// --- Helpers ---------------------------------------------------------------

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Parse the hidden `stakeholders_json` field defensively; never throw. */
function parseStakeholdersJson(
  raw: string,
): { name: string; email: string; phone: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => ({
      name: typeof s?.name === "string" ? s.name : "",
      email: typeof s?.email === "string" ? s.email : "",
      phone: typeof s?.phone === "string" ? s.phone : "",
    }));
  } catch {
    return [];
  }
}

function fieldErrorsFromZod(issues: { path: PropertyKey[]; message: string }[]): {
  fieldErrors: SponsorFieldErrors;
  formErrors: string[];
} {
  const fieldErrors: SponsorFieldErrors = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message);
      continue;
    }
    const key = issue.path.map((p) => String(p)).join(".");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors, formErrors };
}

/** SHA-256 of client IP, salted with the spam secret — never store the raw IP. */
async function hashClientIp(): Promise<string> {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "unknown";
  const salt =
    process.env.RR_SPAM_SECRET ?? process.env.RR_MAGIC_LINK_SECRET ?? "";
  return createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 32);
}

// --- Action ----------------------------------------------------------------

export async function createSponsorApplication(
  _prevState: SponsorFormState,
  formData: FormData,
): Promise<SponsorFormState> {
  // Reconstruct raw values up front so any failure path can echo them back.
  const financialMode: SponsorFinancialMode =
    str(formData, "financial_mode") === "discuss" ? "discuss" : "amount";
  const rawStakeholders = parseStakeholdersJson(str(formData, "stakeholders_json"));

  const values: SponsorFormValues = {
    orgName: str(formData, "org_name"),
    pocName: str(formData, "poc_name"),
    pocEmail: str(formData, "poc_email"),
    pocPhone: str(formData, "poc_phone"),
    painPoints: str(formData, "pain_points"),
    goalsNeeds: str(formData, "goals_needs"),
    financialMode,
    financialAmount: str(formData, "financial_amount"),
    financialNote: str(formData, "financial_note"),
    stakeholders: rawStakeholders,
  };

  // 1. Spam gate FIRST — cheap, and a bot never reaches the DB. Generic error only.
  const spam = getSpamGuard().verify({
    honeypot: str(formData, "contact_time"),
    renderedAt: str(formData, "challenge_ts"),
    sig: str(formData, "challenge_sig"),
  });
  if (!spam.ok) {
    return {
      ok: false,
      formError: "We couldn't verify your submission. Please try again.",
      values,
    };
  }

  // 2. Server-side re-validation (mandatory — client validation is UX only).
  const financialNote = values.financialNote.trim();
  const candidate = {
    orgName: values.orgName,
    pocName: values.pocName,
    pocEmail: values.pocEmail,
    pocPhone: values.pocPhone,
    painPoints: values.painPoints,
    goalsNeeds: values.goalsNeeds,
    financialCommitment: {
      amount: financialMode === "discuss" ? null : values.financialAmount,
      note: financialNote === "" ? undefined : financialNote,
      toDiscuss: financialMode === "discuss",
    },
    stakeholders: rawStakeholders,
  };

  const parsed = sponsorApplicationSchema.safeParse(candidate);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = fieldErrorsFromZod(parsed.error.issues);
    return {
      ok: false,
      fieldErrors,
      formError: formErrors[0],
      values,
    };
  }

  const data = parsed.data;
  const ipHash = await hashClientIp();

  // 3. All writes in ONE transaction — any throw rolls back everything.
  let committed:
    | { orgId: string; applicationId: string; eventId: string }
    | undefined;
  try {
    committed = await db.transaction(async (tx) => {
      // Org: link-or-create by case-insensitive name.
      const existingOrg = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(sql`lower(${organizations.name}) = lower(${data.orgName})`)
        .limit(1);

      const orgId =
        existingOrg[0]?.id ??
        (
          await tx
            .insert(organizations)
            .values({ name: data.orgName })
            .returning({ id: organizations.id })
        )[0].id;

      const [application] = await tx
        .insert(sponsorApplications)
        .values({
          orgId,
          pocName: data.pocName,
          pocEmail: data.pocEmail,
          pocPhone: data.pocPhone,
          painPoints: data.painPoints,
          goalsNeeds: data.goalsNeeds,
          // numeric(12,2) column maps to a string in drizzle — keep it a string.
          financialCommitmentAmount: data.financialCommitment.amount,
          financialCommitmentNote: data.financialCommitment.note ?? null,
          financialCommitmentToDiscuss: data.financialCommitment.toDiscuss,
          status: "submitted",
          submittedAt: new Date(),
        })
        .returning({ id: sponsorApplications.id });

      // Slug is race-proof: random suffix appended unconditionally.
      const slug = `${slugify(data.orgName)}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;

      const [event] = await tx
        .insert(events)
        .values({
          orgId,
          sponsorApplicationId: application.id,
          slug,
          title: data.orgName,
          status: "submitted",
        })
        .returning({ id: events.id });

      await tx.insert(stakeholders).values(
        data.stakeholders.map((s) => ({
          eventId: event.id,
          name: s.name,
          email: s.email,
          phone: s.phone,
        })),
      );

      // Audit: ids + hashed IP only — NO PII in metadata.
      await tx.insert(auditLog).values({
        eventId: event.id,
        actor: "public",
        action: "sponsor_application.created",
        entity: "sponsor_application",
        toValue: "submitted",
        metadata: {
          sponsorApplicationId: application.id,
          orgId,
          eventId: event.id,
          stakeholderCount: data.stakeholders.length,
          ipHash,
        },
      });

      return { orgId, applicationId: application.id, eventId: event.id };
    });
  } catch (err) {
    // Never leak stack traces to the client.
    console.error("[sponsor] createSponsorApplication transaction failed", err);
    return {
      ok: false,
      formError:
        "Something went wrong saving your application. Please try again.",
      values,
    };
  }

  // 4. Emails AFTER commit — a send failure is audit-logged, never fails submit.
  const emailData = {
    orgName: data.orgName,
    pocName: data.pocName,
    pocEmail: data.pocEmail,
    pocPhone: data.pocPhone,
    painPoints: data.painPoints,
    goalsNeeds: data.goalsNeeds,
    financialAmount: data.financialCommitment.amount,
    financialNote: data.financialCommitment.note ?? null,
    financialToDiscuss: data.financialCommitment.toDiscuss,
    stakeholders: data.stakeholders,
  };
  const email = getEmailAdapter();
  const sends = await Promise.allSettled([
    email.send(buildPocAckEmail(emailData)),
    email.send(buildAdminNotifyEmail(emailData)),
  ]);
  const failures = sends.filter((r) => r.status === "rejected").length;
  if (failures > 0) {
    try {
      await db.insert(auditLog).values({
        eventId: committed.eventId,
        actor: "system",
        action: "sponsor_application.email_failed",
        entity: "sponsor_application",
        metadata: {
          sponsorApplicationId: committed.applicationId,
          eventId: committed.eventId,
          failedSends: failures,
        },
      });
    } catch (err) {
      console.error("[sponsor] failed to audit email failure", err);
    }
  }

  // 5. PRG redirect — OUTSIDE the try/catch (redirect throws NEXT_REDIRECT).
  redirect("/sponsor/thanks");
}

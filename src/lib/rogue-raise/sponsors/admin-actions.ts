"use server";

/**
 * Privileged WR-Admin curation actions — deliberately separate from the public
 * `actions.ts` for trust-boundary clarity. Two `useActionState`-shaped actions,
 * `approveSponsorApplication` and `rejectSponsorApplication`, share one internal
 * `decide()` implementation.
 *
 * Guarantees (story 2 acceptance criteria):
 *   - ALL writes happen in ONE `db.transaction`; a throw rolls everything back.
 *   - The application row is `SELECT … FOR UPDATE`-locked so concurrent admins
 *     serialize — no double transitions, no duplicate emails.
 *   - Idempotency guard: only `submitted` / `under_review` are actionable.
 *   - Emails send ONLY after commit (`Promise.allSettled`); a send failure is
 *     audit-logged and never rolls the decision back.
 *   - Two PII-free audit rows per decision (application + event, each from→to).
 *   - Raw magic-link token appears only in the emailed URL, never in the DB/logs.
 *
 * AUTH: `/admin/*` is env-gated dev-open (see src/middleware.ts). There is no
 * Audit rows record the individual admin, so "who approved this sponsor" is
 * answerable
 * until the Better Auth admin story lands. See HANDOFF.md — this MUST NOT deploy
 * publicly before then.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "../db";
import {
  auditLog,
  events,
  organizations,
  magicLinkTokens,
  sponsorApplications,
} from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import {
  type AdminDecisionState,
} from "./admin-decision-state";
import { buildDeclineEmail, buildIntakeInviteEmail } from "./emails";
import { adminActor, adminOrError } from "../admin/guard";
import {
  buildIntakeInviteUrl,
  generateMagicToken,
  MAGIC_LINK_TTL_MS,
  SPONSOR_POC_ROLE,
} from "./magic-link";
import {
  adminDecisionSchema,
  allowedNextStatus,
  isActionableAppStatus,
  type AdminDecision,
  type SponsorAppStatus,
} from "./schema";

// --- Constants & UI-contract types -----------------------------------------

// The `AdminDecisionState` type and `initialAdminDecisionState`
// live in `./admin-decision-state` (imported above) because a `"use server"`
// module may only export async functions — any non-async export throws at
// runtime ("... can only export async functions, found object").

// --- Helpers ---------------------------------------------------------------

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Discriminated outcome returned OUT of the transaction so the caller can map it. */
type TxOutcome =
  | { kind: "not_found" }
  | { kind: "not_actionable" }
  | { kind: "bad_event_link" }
  | {
      kind: "ok";
      decision: AdminDecision;
      eventId: string;
      orgName: string;
      pocName: string;
      pocEmail: string;
      intakeUrl?: string;
    };

// --- Shared implementation -------------------------------------------------

async function decide(
  decision: AdminDecision,
  formData: FormData,
  actor: string,
): Promise<AdminDecisionState> {
  // Never trust a client-sent event id or status — only the application id and
  // the optional note cross the boundary; everything else is resolved server-side.
  const applicationId = str(formData, "application_id");
  if (!z.uuid().safeParse(applicationId).success) {
    return { ok: false, formError: "We couldn't find that application." };
  }

  const rawNote = str(formData, "note").trim();
  const parsedNote = adminDecisionSchema.safeParse({
    note: rawNote === "" ? undefined : rawNote,
  });
  if (!parsedNote.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsedNote.error.issues) {
      const key = issue.path.map((p) => String(p)).join(".") || "note";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors };
  }
  const note = parsedNote.data.note ?? null;

  // All writes in ONE transaction — any throw rolls back everything.
  let outcome: TxOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      // Lock the application row first — serializes concurrent admins.
      const [app] = await tx
        .select({
          id: sponsorApplications.id,
          status: sponsorApplications.status,
          orgId: sponsorApplications.orgId,
          pocName: sponsorApplications.pocName,
          pocEmail: sponsorApplications.pocEmail,
        })
        .from(sponsorApplications)
        .where(eq(sponsorApplications.id, applicationId))
        .for("update")
        .limit(1);

      if (!app) return { kind: "not_found" as const };
      if (!isActionableAppStatus(app.status)) {
        return { kind: "not_actionable" as const };
      }

      // Resolve the linked event — refuse unless EXACTLY one resolves.
      const linked = await tx
        .select({ id: events.id, status: events.status })
        .from(events)
        .where(eq(events.sponsorApplicationId, applicationId));
      if (linked.length !== 1) return { kind: "bad_event_link" as const };
      const event = linked[0];

      const next = allowedNextStatus(app.status as SponsorAppStatus, decision);
      const now = new Date();

      await tx
        .update(sponsorApplications)
        .set({ status: next.appStatus, adminNote: note, updatedAt: now })
        .where(eq(sponsorApplications.id, applicationId));

      await tx
        .update(events)
        .set({ status: next.eventStatus, updatedAt: now })
        .where(eq(events.id, event.id));

      // Approve mints a hashed, event-scoped, expiring sponsor_poc token.
      let intakeUrl: string | undefined;
      if (decision === "approve") {
        const { raw, hash } = generateMagicToken();
        await tx.insert(magicLinkTokens).values({
          eventId: event.id,
          role: SPONSOR_POC_ROLE,
          // subject_id references the sponsor application (the POC's subject in
          // v1). Redemption resolves the POC via the application → event link.
          subjectId: applicationId,
          email: app.pocEmail,
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
        });
        intakeUrl = buildIntakeInviteUrl(event.id, raw);
      }

      // Two audit rows — ids only in metadata, NO PII, raw token never recorded.
      const metadata = {
        via: decision,
        applicationId,
        eventId: event.id,
      };
      await tx.insert(auditLog).values({
        eventId: event.id,
        actor,
        action: `sponsor_application.${next.appStatus}`,
        entity: "sponsor_application",
        fromValue: app.status,
        toValue: next.appStatus,
        metadata,
      });
      await tx.insert(auditLog).values({
        eventId: event.id,
        actor,
        action: `event.${next.eventStatus}`,
        entity: "event",
        fromValue: event.status,
        toValue: next.eventStatus,
        metadata,
      });

      // Org name needed for the email; read (no lock needed) inside the tx.
      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, app.orgId))
        .limit(1);

      return {
        kind: "ok" as const,
        decision,
        eventId: event.id,
        orgName: org?.name ?? "",
        pocName: app.pocName,
        pocEmail: app.pocEmail,
        intakeUrl,
      };
    });
  } catch (err) {
    console.error("[admin] decide transaction failed", err);
    return {
      ok: false,
      formError:
        "Something went wrong recording your decision. Please try again.",
    };
  }

  if (outcome.kind === "not_found") {
    return { ok: false, formError: "We couldn't find that application." };
  }
  if (outcome.kind === "not_actionable") {
    return { ok: false, formError: "This application has already been decided." };
  }
  if (outcome.kind === "bad_event_link") {
    // Generic — never reveals the data-integrity detail to the client.
    return {
      ok: false,
      formError:
        "This application isn't linked to a single event and can't be decided here.",
    };
  }

  // Emails AFTER commit — a send failure is audit-logged, never rolled back.
  const email = getEmailAdapter();
  const message =
    outcome.decision === "approve"
      ? buildIntakeInviteEmail({
          orgName: outcome.orgName,
          pocName: outcome.pocName,
          pocEmail: outcome.pocEmail,
          intakeUrl: outcome.intakeUrl ?? "",
        })
      : buildDeclineEmail({
          orgName: outcome.orgName,
          pocName: outcome.pocName,
          pocEmail: outcome.pocEmail,
        });

  const sends = await Promise.allSettled([email.send(message)]);
  const failures = sends.filter((r) => r.status === "rejected").length;
  if (failures > 0) {
    try {
      await db.insert(auditLog).values({
        eventId: outcome.eventId,
        actor: "system",
        action: "sponsor_application.email_failed",
        entity: "sponsor_application",
        metadata: {
          via: outcome.decision,
          applicationId,
          eventId: outcome.eventId,
          failedSends: failures,
        },
      });
    } catch (err) {
      console.error("[admin] failed to audit email failure", err);
    }
  }

  // Refresh the badge + queue, then PRG redirect — OUTSIDE try/catch
  // (redirect throws NEXT_REDIRECT).
  revalidatePath("/admin");
  revalidatePath("/admin/sponsors");
  redirect("/admin/sponsors");
}

// --- Exported actions ------------------------------------------------------

export async function approveSponsorApplication(
  _prevState: AdminDecisionState,
  formData: FormData,
): Promise<AdminDecisionState> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, formError: guard.error };

  return decide("approve", formData, adminActor(guard.admin));
}

export async function rejectSponsorApplication(
  _prevState: AdminDecisionState,
  formData: FormData,
): Promise<AdminDecisionState> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, formError: guard.error };

  return decide("reject", formData, adminActor(guard.admin));
}

"use server";

/**
 * Participant registration (PRD §6.2).
 *
 * Public and unauthenticated, so it carries the same posture as the sponsor
 * sign-up: spam-gated first, re-validated server-side, all writes in one
 * transaction, confirmation email only after commit.
 *
 * Registration is gated on `Event.status = registration_open`, re-checked under
 * a row lock inside the transaction — a form left open while staff closed
 * registration must not still create a participant.
 */
import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "../db";
import { auditLog, contextRepos, events, organizations, participants } from "../db/schema";
import { checkGithubUser } from "../integrations/github";
import { getEmailAdapter } from "../integrations/email";
import { getSpamGuard, getSpamSecret } from "../integrations/spam";
import { describeSchedule, formatWeekendLabel } from "../intake/schedule";
import { buildParticipantConfirmationEmail } from "./emails";
import type { RegistrationState, RegistrationValues } from "./form-state";
import { participantSchema } from "./schema";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** SHA-256 of client IP, salted — never store the raw IP. */
async function hashClientIp(): Promise<string> {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "unknown";
  return createHash("sha256")
    .update(`${ip}:${getSpamSecret()}`)
    .digest("hex")
    .slice(0, 32);
}

type RegisterOutcome =
  | { kind: "closed" }
  | { kind: "duplicate" }
  | { kind: "ok"; eventId: string; participantId: string };

export async function registerParticipant(
  _prevState: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const slug = str(formData, "event_slug");
  const values: RegistrationValues = {
    firstName: str(formData, "first_name"),
    lastName: str(formData, "last_name"),
    email: str(formData, "email"),
    githubUsername: str(formData, "github_username"),
  };

  // 1. Spam gate first — cheap, and a bot never reaches the database.
  const spam = getSpamGuard().verify({
    honeypot: str(formData, "contact_time"),
    renderedAt: str(formData, "challenge_ts"),
    sig: str(formData, "challenge_sig"),
  });
  if (!spam.ok) {
    return {
      ok: false,
      formError:
        spam.reason === "too_old"
          ? "This page has been open a while and your session expired. Please refresh and try again."
          : "We couldn't verify your submission. Please try again.",
      values,
    };
  }

  // 2. Mandatory server-side validation.
  const parsed = participantSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors, values };
  }
  const data = parsed.data;

  // 3. Existence check — advisory only. `unknown` (rate limit, timeout) lets
  //    them through: our infrastructure problem must not become theirs.
  const exists = await checkGithubUser(data.githubUsername);
  if (exists === false) {
    return {
      ok: false,
      fieldErrors: {
        githubUsername: [
          `We couldn't find github.com/${data.githubUsername}. Check the spelling — or create an account and come back.`,
        ],
      },
      values,
    };
  }

  const ipHash = await hashClientIp();

  let outcome: RegisterOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const [event] = await tx
        .select({ id: events.id, status: events.status })
        .from(events)
        .where(eq(events.slug, slug))
        .for("update")
        .limit(1);
      // Re-checked under the lock: a form left open while staff closed
      // registration must not still create a participant.
      if (!event || event.status !== "registration_open") {
        return { kind: "closed" as const };
      }

      const [existing] = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.eventId, event.id),
            sql`lower(${participants.email}) = lower(${data.email})`,
          ),
        )
        .limit(1);
      if (existing) return { kind: "duplicate" as const };

      const [participant] = await tx
        .insert(participants)
        .values({
          eventId: event.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          githubUsername: data.githubUsername,
        })
        .returning({ id: participants.id });

      await tx.insert(auditLog).values({
        eventId: event.id,
        actor: "public",
        action: "participant.registered",
        entity: "participant",
        toValue: "registered",
        // Ids and a hashed IP only — no PII in the audit log.
        metadata: { eventId: event.id, participantId: participant.id, ipHash },
      });

      return { kind: "ok" as const, eventId: event.id, participantId: participant.id };
    });
  } catch (err) {
    console.error("[participants] registration failed", err);
    return {
      ok: false,
      formError: "Something went wrong saving your registration. Please try again.",
      values,
    };
  }

  if (outcome.kind === "closed") {
    return {
      ok: false,
      formError: "Registration for this Rogue Raise isn't open right now.",
      values,
    };
  }
  if (outcome.kind === "duplicate") {
    // Graceful, and not a dead end: they are already in.
    return {
      ok: false,
      formError:
        "You're already registered with that email — check your inbox for the confirmation, or email us if it never arrived.",
      values,
    };
  }

  await sendConfirmation(outcome.eventId, outcome.participantId, data);

  // PRG — outside the try/catch, since redirect throws NEXT_REDIRECT.
  redirect(`/events/${slug}/registered`);
}

async function sendConfirmation(
  eventId: string,
  participantId: string,
  data: { firstName: string; email: string },
): Promise<void> {
  const [event] = await db
    .select({
      title: events.title,
      slug: events.slug,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      locationName: events.locationName,
      locationAddress: events.locationAddress,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return;

  const [repo] = await db
    .select({ url: contextRepos.githubRepoUrl, isPublic: contextRepos.isPublic })
    .from(contextRepos)
    .where(eq(contextRepos.eventId, eventId))
    .limit(1);

  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  const [result] = await Promise.allSettled([
    getEmailAdapter().send(
      buildParticipantConfirmationEmail({
        firstName: data.firstName,
        email: data.email,
        eventTitle: event.title,
        organizationName: event.organizationName,
        weekendLabel: event.confirmedFridayKickoffAt
          ? formatWeekendLabel(event.confirmedFridayKickoffAt)
          : null,
        scheduleLines: event.confirmedFridayKickoffAt
          ? describeSchedule(event.confirmedFridayKickoffAt)
          : [],
        location: [event.locationName, event.locationAddress]
          .filter(Boolean)
          .join(", ") || null,
        eventUrl: `${base}/events/${event.slug}`,
        // Only link a repo the participant can actually open.
        repoUrl: repo?.isPublic ? repo.url : null,
      }),
    ),
  ]);

  if (result.status === "rejected") {
    try {
      await db.insert(auditLog).values({
        eventId,
        actor: "system",
        action: "participant.confirmation_email_failed",
        entity: "participant",
        metadata: { eventId, participantId },
      });
    } catch (err) {
      console.error("[participants] failed to audit email failure", err);
    }
  }
}

"use server";

/**
 * Project submission (PRD §7.1).
 *
 * Magic-link gated per participant, re-verified on every write. One submission
 * per team, and the submitting participant is recorded as a member — so a team
 * is never submitted by someone who isn't on it.
 *
 * The window is re-checked under a row lock: a form opened at 3:55 and
 * submitted at 4:05, after staff closed submissions, must not slip through.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "../db";
import {
  auditLog,
  events,
  participants,
  submissions,
  teamMemberships,
  teams,
} from "../db/schema";
import { checkGithubRepo } from "../integrations/github";
import {
  participantAccessMessage,
  redeemParticipantToken,
} from "../participants/access";
import type { SubmissionFormState, SubmissionFormValues } from "./form-state";
import { isSubmissionWindowOpen } from "./invite";
import { submissionSchema } from "./schema";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function parseMembers(raw: string): { name: string; email: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => ({
      name: typeof m?.name === "string" ? m.name : "",
      email: typeof m?.email === "string" ? m.email : "",
    }));
  } catch {
    return [];
  }
}

type SubmitOutcome =
  | { kind: "closed" }
  | { kind: "already" }
  | { kind: "ok"; eventId: string; submissionId: string };

export async function submitProject(
  prevState: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const eventId = str(formData, "event_id");
  const token = str(formData, "token");
  const values: SubmissionFormValues = {
    teamName: str(formData, "team_name"),
    projectSummary: str(formData, "project_summary"),
    repoUrl: str(formData, "repo_url"),
    pitchMaterialsUrl: str(formData, "pitch_materials_url"),
    members: parseMembers(str(formData, "members_json")),
  };
  const version = (prevState.version ?? 0) + 1;

  const access = await redeemParticipantToken({ rawToken: token, eventId });
  if (!access.ok) {
    return {
      ok: false,
      formError: participantAccessMessage(access.reason),
      values,
      version,
    };
  }

  const parsed = submissionSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors, values, version };
  }
  const data = parsed.data;

  // Advisory, three-valued: a rate limit or a private repo must not block a
  // team that just built for two days. Only a definite 404 stops them, and the
  // copy says a private repo looks the same from here.
  const reachable = await checkGithubRepo(data.repoUrl);
  if (reachable === false) {
    return {
      ok: false,
      fieldErrors: {
        repoUrl: [
          "We couldn't reach that repository. Check the URL — and if it's private, make it public or tell an organizer.",
        ],
      },
      values,
      version,
    };
  }

  let outcome: SubmitOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const [event] = await tx
        .select({ id: events.id, status: events.status })
        .from(events)
        .where(eq(events.id, eventId))
        .for("update")
        .limit(1);
      if (!event || !isSubmissionWindowOpen(event.status)) {
        return { kind: "closed" as const };
      }

      // One submission per team, and a participant belongs to one team.
      const [existing] = await tx
        .select({ id: teamMemberships.id })
        .from(teamMemberships)
        .where(eq(teamMemberships.participantId, access.access.participant.id))
        .limit(1);
      if (existing) return { kind: "already" as const };

      const [team] = await tx
        .insert(teams)
        .values({ eventId, name: data.teamName })
        .returning({ id: teams.id });

      // Members are matched to registered participants by email; anyone not
      // registered is still listed on the submission but isn't linked, because
      // we can't invent a participant row for them.
      const emails = data.members.map((m) => m.email.toLowerCase());
      const registered = emails.length
        ? await tx
            .select({ id: participants.id, email: participants.email })
            .from(participants)
            .where(
              and(
                eq(participants.eventId, eventId),
                inArray(sql`lower(${participants.email})`, emails),
              ),
            )
        : [];

      const memberIds = new Set(registered.map((r) => r.id));
      // The submitter is always on their own team.
      memberIds.add(access.access.participant.id);

      await tx.insert(teamMemberships).values(
        [...memberIds].map((participantId) => ({
          teamId: team.id,
          participantId,
        })),
      );

      const [submission] = await tx
        .insert(submissions)
        .values({
          eventId,
          teamId: team.id,
          teamName: data.teamName,
          projectSummary: data.projectSummary,
          repoUrl: data.repoUrl,
          pitchMaterialsUrl: data.pitchMaterialsUrl ?? null,
          submittedAt: new Date(),
        })
        .returning({ id: submissions.id });

      await tx.insert(auditLog).values({
        eventId,
        actor: "participant",
        action: "submission.created",
        entity: "submission",
        toValue: "submitted",
        metadata: {
          eventId,
          submissionId: submission.id,
          teamId: team.id,
          memberCount: memberIds.size,
        },
      });

      return { kind: "ok" as const, eventId, submissionId: submission.id };
    });
  } catch (err) {
    console.error("[submissions] submitProject failed", err);
    return {
      ok: false,
      formError:
        "Something went wrong saving your submission. Your answers are still here — please try again.",
      values,
      version,
    };
  }

  if (outcome.kind === "closed") {
    return {
      ok: false,
      formError:
        "Submissions are closed for this Rogue Raise. Find an organizer — don't just walk away.",
      values,
      version,
    };
  }
  if (outcome.kind === "already") {
    return {
      ok: false,
      formError:
        "You're already on a team that submitted. If that's wrong, find an organizer.",
      values,
      version,
    };
  }

  redirect(`/submit/${eventId}/done`);
}

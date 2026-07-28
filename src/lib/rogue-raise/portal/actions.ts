"use server";

/**
 * Stewardship marking (PRD §8.3) — the handoff bridge.
 *
 * This is the smallest action in the platform and arguably the most important
 * one: it is where a stakeholder commits, in writing, to carrying a project
 * forward. That is what separates a Rogue Raise from a hackathon, so the write
 * is token-gated per stakeholder, audited with who did it, and reversible —
 * somebody who marks "adopted" and then realises their team can't maintain it
 * must be able to say so rather than leaving a false promise on the record.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, submissions } from "../db/schema";
import { redeemStakeholderToken, stakeholderAccessMessage } from "./access";
import { isStewardshipValue, type StewardshipValue } from "./stewardship";

export interface StewardshipResult {
  ok: boolean;
  error?: string;
  submissionId?: string;
  stewardship?: StewardshipValue;
}

export async function markStewardship(input: {
  eventId: string;
  token: string;
  submissionId: string;
  stewardship: string;
}): Promise<StewardshipResult> {
  if (!isStewardshipValue(input.stewardship)) {
    return { ok: false, error: "That isn't one of the options." };
  }

  const access = await redeemStakeholderToken({
    rawToken: input.token,
    eventId: input.eventId,
  });
  if (!access.ok) {
    return { ok: false, error: stakeholderAccessMessage(access.reason) };
  }

  const [submission] = await db
    .select({
      id: submissions.id,
      eventId: submissions.eventId,
      stewardship: submissions.stewardship,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        // Scoped in the query itself, not checked after: a submission from
        // another event is simply not found.
        eq(submissions.eventId, input.eventId),
      ),
    )
    .limit(1);
  if (!submission) return { ok: false, error: "We couldn't find that project." };

  if (submission.stewardship === input.stewardship) {
    return { ok: true, submissionId: submission.id, stewardship: input.stewardship };
  }

  await db
    .update(submissions)
    .set({ stewardship: input.stewardship, updatedAt: new Date() })
    .where(eq(submissions.id, submission.id));

  await db.insert(auditLog).values({
    eventId: input.eventId,
    // Named, because "who committed to maintaining this" is the whole point.
    actor: `stakeholder:${access.access.stakeholder.id}`,
    action: "submission.stewardship_marked",
    entity: "submission",
    fromValue: submission.stewardship,
    toValue: input.stewardship,
    metadata: {
      submissionId: submission.id,
      stakeholderId: access.access.stakeholder.id,
      stakeholderName: access.access.stakeholder.name,
    },
  });

  revalidatePath(`/portal/${input.eventId}`);
  return { ok: true, submissionId: submission.id, stewardship: input.stewardship };
}

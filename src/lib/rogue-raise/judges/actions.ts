"use server";

/**
 * Judge background form action (PRD §5.3.4).
 *
 * Like the sponsor intake, the magic link is re-verified on every write — the
 * page render is never treated as authorization. A judge's own token can only
 * ever write that judge's row, because the row is resolved from the token's
 * `subject_id` rather than from anything the form submits.
 *
 * A question about the evaluative criteria is emailed to WR Admin AND the
 * sponsor POC after the save commits, so a send failure can't lose the answer
 * the judge already gave.
 */
import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, judges, sponsorApplications, events } from "../db/schema";
import { getEmailAdapter } from "../integrations/email";
import { judgeAccessMessage, redeemJudgeToken } from "./access";
import { buildCriteriaQuestionEmail } from "./emails";
import type { JudgeFormState } from "./form-state";
import { judgeBackgroundSchema } from "./schema";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function bump(prev: JudgeFormState): number {
  return (prev.version ?? 0) + 1;
}

export async function saveJudgeBackground(
  prevState: JudgeFormState,
  formData: FormData,
): Promise<JudgeFormState> {
  const eventId = str(formData, "event_id");
  const token = str(formData, "token");

  const access = await redeemJudgeToken({ rawToken: token, eventId });
  if (!access.ok) {
    return {
      ...prevState,
      status: "error",
      formError: judgeAccessMessage(access.reason),
      version: bump(prevState),
    };
  }

  const tags = str(formData, "expertise_tags")
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const parsed = judgeBackgroundSchema.safeParse({
    name: str(formData, "name"),
    title: str(formData, "title"),
    bio: str(formData, "bio"),
    expertiseTags: tags,
    introPreference: str(formData, "intro_preference"),
    criteriaQuestions: str(formData, "criteria_questions"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ...prevState,
      status: "error",
      formError: "Some entries need a small fix.",
      fieldErrors,
      version: bump(prevState),
    };
  }

  const data = parsed.data;
  const judgeId = access.access.judge.id;
  // Only email the question when it's new — an unchanged answer on a re-save
  // shouldn't page anyone a second time.
  const questionIsNew =
    Boolean(data.criteriaQuestions) &&
    data.criteriaQuestions !== access.access.judge.criteriaQuestions;

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(judges)
        .set({
          name: data.name,
          title: data.title ?? null,
          bio: data.bio ?? null,
          expertiseTags: data.expertiseTags,
          introPreference: data.introPreference ?? null,
          criteriaQuestions: data.criteriaQuestions ?? null,
          backgroundCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(judges.id, judgeId));

      await tx.insert(auditLog).values({
        eventId: access.access.event.id,
        actor: "judge",
        action: "judge.background_saved",
        entity: "judge",
        toValue: "completed",
        // Ids only — the bio and the question stay on the row.
        metadata: {
          eventId: access.access.event.id,
          judgeId,
          tokenId: access.access.tokenId,
          hadQuestion: questionIsNew,
        },
      });
    });
  } catch (err) {
    console.error("[judges] saveJudgeBackground failed", err);
    return {
      ...prevState,
      status: "error",
      formError:
        "Something went wrong saving that. Your answers are still here — please try again.",
      version: bump(prevState),
    };
  }

  if (questionIsNew) {
    await notifyCriteriaQuestion({
      eventId: access.access.event.id,
      eventTitle: access.access.event.title,
      organizationName: access.access.event.organizationName,
      judgeName: data.name,
      judgeEmail: access.access.judge.email,
      question: data.criteriaQuestions!,
    });
  }

  return {
    status: "saved",
    savedAt: now.toISOString(),
    complete: true,
    version: bump(prevState),
  };
}

/** Routes a judge's criteria question to WR Admin and the sponsor POC. */
async function notifyCriteriaQuestion(input: {
  eventId: string;
  eventTitle: string;
  organizationName: string;
  judgeName: string;
  judgeEmail: string;
  question: string;
}): Promise<void> {
  const recipients = [process.env.RR_ADMIN_NOTIFY_EMAIL ?? "admin@example.com"];

  const [poc] = await db
    .select({ email: sponsorApplications.pocEmail })
    .from(events)
    .innerJoin(
      sponsorApplications,
      eq(events.sponsorApplicationId, sponsorApplications.id),
    )
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (poc?.email) recipients.push(poc.email);

  const [result] = await Promise.allSettled([
    getEmailAdapter().send(
      buildCriteriaQuestionEmail({
        judgeName: input.judgeName,
        judgeEmail: input.judgeEmail,
        eventTitle: input.eventTitle,
        organizationName: input.organizationName,
        question: input.question,
        to: recipients,
      }),
    ),
  ]);
  if (result.status === "rejected") {
    try {
      await db.insert(auditLog).values({
        eventId: input.eventId,
        actor: "system",
        action: "judge.criteria_question_email_failed",
        entity: "judge",
        metadata: { eventId: input.eventId },
      });
    } catch (err) {
      console.error("[judges] failed to audit question-email failure", err);
    }
  }
}

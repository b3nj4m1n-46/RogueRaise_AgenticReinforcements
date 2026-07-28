/**
 * Intake read model — everything the intake page renders, loaded in one place.
 *
 * DELIBERATELY NOT a `"use server"` module. Exports from such a module become
 * callable POST endpoints, and a reader keyed only on `eventId` would then be a
 * way to pull someone's intake without ever presenting a magic link. Keeping it
 * a plain server-side module means the only way in is a Server Component that
 * has already redeemed a token.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  attachments,
  criteria,
  dateOptions,
  eventIntakes,
  judges,
  techSponsors,
} from "../db/schema";
import { INTAKE_ATTACHMENT_KIND } from "./constants";
import {
  DEFAULT_KICKOFF_HOUR,
  toDateStringInZone,
  zonedParts,
} from "./schedule";
import {
  emptyIntakeDraft,
  TECH_SPONSOR_STATUSES,
  type IntakeDraft,
  type TechSponsorStatus,
} from "./schema";

export interface IntakeAttachmentView {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface LoadedIntake {
  draft: IntakeDraft;
  attachments: IntakeAttachmentView[];
  /** ISO timestamp, or null while the intake is still incomplete. */
  completedAt: string | null;
}

/** Free-text legacy/foreign statuses fall back to the safe default. */
function normalizeSponsorStatus(value: string | null): TechSponsorStatus {
  return (TECH_SPONSOR_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as TechSponsorStatus)
    : "proposed";
}

export async function loadIntake(eventId: string): Promise<LoadedIntake> {
  const [
    intakeRows,
    dateRows,
    criteriaRows,
    sponsorRows,
    judgeRows,
    attachmentRows,
  ] = await Promise.all([
    db.select().from(eventIntakes).where(eq(eventIntakes.eventId, eventId)).limit(1),
    db
      .select()
      .from(dateOptions)
      .where(eq(dateOptions.eventId, eventId))
      .orderBy(dateOptions.fridayKickoffAt),
    db
      .select()
      .from(criteria)
      .where(eq(criteria.eventId, eventId))
      .orderBy(criteria.sortOrder),
    db
      .select()
      .from(techSponsors)
      .where(eq(techSponsors.eventId, eventId))
      .orderBy(techSponsors.createdAt),
    db
      .select()
      .from(judges)
      .where(eq(judges.eventId, eventId))
      .orderBy(judges.createdAt),
    db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.eventId, eventId),
          eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
        ),
      )
      .orderBy(attachments.createdAt),
  ]);

  const intake = intakeRows[0];

  const draft: IntakeDraft = {
    ...emptyIntakeDraft(),
    judges: judgeRows.map((j) => ({
      name: j.name,
      email: j.email,
      phone: j.phone ?? undefined,
    })),
    criteria: criteriaRows.map((c) => ({
      label: c.label,
      description: c.description ?? undefined,
      weight: c.weight ?? undefined,
    })),
    // Stored as an instant; the form edits it as a Pacific calendar date + hour.
    dateOptions: dateRows.map((d) => ({
      date: toDateStringInZone(d.fridayKickoffAt),
      kickoffHour: zonedParts(d.fridayKickoffAt).hour || DEFAULT_KICKOFF_HOUR,
    })),
    techSponsors: sponsorRows.map((s) => ({
      name: s.name,
      offering: s.offering ?? undefined,
      contactName: s.contactName ?? undefined,
      contactEmail: s.contactEmail ?? undefined,
      status: normalizeSponsorStatus(s.status),
    })),
    awardsBudget: {
      amount: intake?.awardsBudgetAmount ?? undefined,
      note: intake?.awardsBudgetNote ?? undefined,
    },
    supplementaryInfo: intake?.supplementaryInfo ?? undefined,
    stakeholderTechStack: intake?.stakeholderTechStack ?? undefined,
    stakeholderTechTags: intake?.stakeholderTechTags ?? [],
  };

  return {
    draft,
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      filename: a.filename ?? "attachment",
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
    completedAt: intake?.completedAt?.toISOString() ?? null,
  };
}

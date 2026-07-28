/**
 * Admin read model for events.
 *
 * DELIBERATELY NOT a `"use server"` module — exports there become POST
 * endpoints, and these readers are keyed only on an event id. They are reachable
 * only from Server Components already behind the `/admin` env gate.
 *
 * The list view resolves intake progress for every event WITHOUT an N+1: one
 * grouped count per child collection, assembled in memory.
 */
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  attachments,
  criteria,
  dateOptions,
  eventIntakes,
  events,
  judges,
  organizations,
  sponsorApplications,
  stakeholders,
  techSponsors,
} from "../db/schema";
import { INTAKE_ATTACHMENT_KIND } from "../intake/constants";
import {
  evaluateCompleteness,
  type CompletenessResult,
} from "../intake/completeness";
import { expandSchedule, type WeekendSchedule } from "../intake/schedule";

export interface AdminEventListRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  organizationName: string;
  createdAt: string;
  confirmedFridayKickoffAt: string | null;
  completeness: CompletenessResult;
}

/** Grouped `count(*)` keyed by event id, for the ids we care about. */
async function countsByEvent(
  table:
    | typeof dateOptions
    | typeof criteria
    | typeof techSponsors
    | typeof judges,
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: table.eventId, n: count() })
    .from(table)
    .where(inArray(table.eventId, eventIds))
    .groupBy(table.eventId);
  return new Map(rows.map((r) => [r.eventId, Number(r.n)]));
}

async function attachmentCountsByEvent(
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: attachments.eventId, n: count() })
    .from(attachments)
    .where(
      and(
        inArray(attachments.eventId, eventIds),
        eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
      ),
    )
    .groupBy(attachments.eventId);
  return new Map(rows.map((r) => [r.eventId, Number(r.n)]));
}

export async function listAdminEvents(
  status?: string,
): Promise<AdminEventListRow[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      slug: events.slug,
      status: events.status,
      createdAt: events.createdAt,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(status ? eq(events.status, status as "draft") : undefined)
    .orderBy(desc(events.createdAt));

  const eventIds = rows.map((r) => r.id);
  const [dateCounts, criteriaCounts, sponsorCounts, judgeCounts, fileCounts] =
    await Promise.all([
      countsByEvent(dateOptions, eventIds),
      countsByEvent(criteria, eventIds),
      countsByEvent(techSponsors, eventIds),
      countsByEvent(judges, eventIds),
      attachmentCountsByEvent(eventIds),
    ]);

  const intakeRows = eventIds.length
    ? await db
        .select({
          eventId: eventIntakes.eventId,
          supplementaryInfo: eventIntakes.supplementaryInfo,
          stakeholderTechStack: eventIntakes.stakeholderTechStack,
          awardsBudgetAmount: eventIntakes.awardsBudgetAmount,
          awardsBudgetNote: eventIntakes.awardsBudgetNote,
        })
        .from(eventIntakes)
        .where(inArray(eventIntakes.eventId, eventIds))
    : [];
  const intakes = new Map(intakeRows.map((r) => [r.eventId, r]));

  return rows.map((row) => {
    const intake = intakes.get(row.id);
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      organizationName: row.organizationName,
      createdAt: row.createdAt.toISOString(),
      confirmedFridayKickoffAt:
        row.confirmedFridayKickoffAt?.toISOString() ?? null,
      completeness: evaluateCompleteness({
        dateOptionCount: dateCounts.get(row.id) ?? 0,
        supplementaryInfo: intake?.supplementaryInfo ?? null,
        attachmentCount: fileCounts.get(row.id) ?? 0,
        stakeholderTechStack: intake?.stakeholderTechStack ?? null,
        judgeCount: judgeCounts.get(row.id) ?? 0,
        criteriaCount: criteriaCounts.get(row.id) ?? 0,
        techSponsorCount: sponsorCounts.get(row.id) ?? 0,
        awardsBudgetAmount: intake?.awardsBudgetAmount ?? null,
        awardsBudgetNote: intake?.awardsBudgetNote ?? null,
      }),
    };
  });
}

/** Counts by status for the filter chips. */
export async function countAdminEventsByStatus(): Promise<
  Record<string, number>
> {
  const rows = await db
    .select({ status: events.status, n: count() })
    .from(events)
    .groupBy(events.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export interface AdminWeekendOption {
  id: string;
  isConfirmed: boolean;
  schedule: WeekendSchedule;
}

export interface AdminEventDetail {
  id: string;
  title: string;
  slug: string;
  status: string;
  organizationName: string;
  confirmedFridayKickoffAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  application: {
    id: string;
    pocName: string;
    pocEmail: string;
    pocPhone: string;
    painPoints: string;
    goalsNeeds: string;
    adminNote: string | null;
  } | null;
  stakeholders: { id: string; name: string; email: string; phone: string | null }[];
  weekends: AdminWeekendOption[];
  intake: {
    supplementaryInfo: string | null;
    stakeholderTechStack: string | null;
    stakeholderTechTags: string[];
    awardsBudgetAmount: string | null;
    awardsBudgetNote: string | null;
    completedAt: string | null;
  } | null;
  judges: { id: string; name: string; email: string; phone: string | null }[];
  criteria: {
    id: string;
    label: string;
    description: string | null;
    weight: string | null;
  }[];
  techSponsors: {
    id: string;
    name: string;
    offering: string | null;
    contactName: string | null;
    contactEmail: string | null;
    status: string | null;
  }[];
  attachments: {
    id: string;
    filename: string;
    contentType: string | null;
    sizeBytes: number | null;
  }[];
  completeness: CompletenessResult;
}

export async function loadAdminEvent(
  eventId: string,
): Promise<AdminEventDetail | null> {
  const [event] = await db
    .select({
      id: events.id,
      title: events.title,
      slug: events.slug,
      status: events.status,
      sponsorApplicationId: events.sponsorApplicationId,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      locationName: events.locationName,
      locationAddress: events.locationAddress,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;

  const [
    applicationRows,
    stakeholderRows,
    weekendRows,
    intakeRows,
    judgeRows,
    criteriaRows,
    sponsorRows,
    attachmentRows,
  ] = await Promise.all([
    event.sponsorApplicationId
      ? db
          .select({
            id: sponsorApplications.id,
            pocName: sponsorApplications.pocName,
            pocEmail: sponsorApplications.pocEmail,
            pocPhone: sponsorApplications.pocPhone,
            painPoints: sponsorApplications.painPoints,
            goalsNeeds: sponsorApplications.goalsNeeds,
            adminNote: sponsorApplications.adminNote,
          })
          .from(sponsorApplications)
          .where(eq(sponsorApplications.id, event.sponsorApplicationId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.eventId, eventId))
      .orderBy(stakeholders.createdAt),
    db
      .select()
      .from(dateOptions)
      .where(eq(dateOptions.eventId, eventId))
      .orderBy(dateOptions.fridayKickoffAt),
    db.select().from(eventIntakes).where(eq(eventIntakes.eventId, eventId)).limit(1),
    db.select().from(judges).where(eq(judges.eventId, eventId)).orderBy(judges.createdAt),
    db.select().from(criteria).where(eq(criteria.eventId, eventId)).orderBy(criteria.sortOrder),
    db
      .select()
      .from(techSponsors)
      .where(eq(techSponsors.eventId, eventId))
      .orderBy(techSponsors.createdAt),
    db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
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

  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    status: event.status,
    organizationName: event.organizationName,
    confirmedFridayKickoffAt:
      event.confirmedFridayKickoffAt?.toISOString() ?? null,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    application: applicationRows[0] ?? null,
    stakeholders: stakeholderRows.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
    })),
    // Only the Friday instant is stored; the rest of the weekend is derived, so
    // the console and every generated artifact read the same template.
    weekends: weekendRows.map((w) => ({
      id: w.id,
      isConfirmed: w.isConfirmed,
      schedule: expandSchedule(w.fridayKickoffAt),
    })),
    intake: intake
      ? {
          supplementaryInfo: intake.supplementaryInfo,
          stakeholderTechStack: intake.stakeholderTechStack,
          stakeholderTechTags: intake.stakeholderTechTags ?? [],
          awardsBudgetAmount: intake.awardsBudgetAmount,
          awardsBudgetNote: intake.awardsBudgetNote,
          completedAt: intake.completedAt?.toISOString() ?? null,
        }
      : null,
    judges: judgeRows.map((j) => ({
      id: j.id,
      name: j.name,
      email: j.email,
      phone: j.phone,
    })),
    criteria: criteriaRows.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      weight: c.weight,
    })),
    techSponsors: sponsorRows.map((s) => ({
      id: s.id,
      name: s.name,
      offering: s.offering,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      status: s.status,
    })),
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      filename: a.filename ?? "attachment",
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    })),
    completeness: evaluateCompleteness({
      dateOptionCount: weekendRows.length,
      supplementaryInfo: intake?.supplementaryInfo ?? null,
      attachmentCount: attachmentRows.length,
      stakeholderTechStack: intake?.stakeholderTechStack ?? null,
      judgeCount: judgeRows.length,
      criteriaCount: criteriaRows.length,
      techSponsorCount: sponsorRows.length,
      awardsBudgetAmount: intake?.awardsBudgetAmount ?? null,
      awardsBudgetNote: intake?.awardsBudgetNote ?? null,
    }),
  };
}

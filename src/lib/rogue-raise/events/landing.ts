/**
 * Public landing-page read model (PRD §6.1).
 *
 * Two rules shape it:
 *   - **The schedule, date, and location come from the EVENT**, never from the
 *     agent's copy. The marketing agent is deliberately told not to write them,
 *     so copy can't go stale when a weekend moves.
 *   - **Only APPROVED copy is public.** An unreviewed draft on a public page
 *     would defeat the whole review gate, so a page with no approved copy falls
 *     back to what the sponsor themselves wrote in their application.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { events, generatedAssets, organizations, participants, sponsorApplications } from "../db/schema";
import { describeSchedule, formatWeekendLabel } from "../intake/schedule";
import { count } from "drizzle-orm";

/** Statuses in which the public page exists at all. */
export const PUBLIC_STATUSES = [
  "registration_open",
  "live",
  "judging",
  "completed",
] as const;

export function isPublicEvent(status: string): boolean {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

export function isRegistrationOpen(status: string): boolean {
  return status === "registration_open";
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface LandingPageView {
  id: string;
  slug: string;
  title: string;
  status: string;
  organizationName: string;
  /** Agent copy when approved, otherwise the sponsor's own words. */
  headline: string;
  summary: string;
  sections: { heading: string; bullets: string[] }[];
  faq: FaqEntry[];
  weekendLabel: string | null;
  scheduleLines: string[];
  locationName: string | null;
  locationAddress: string | null;
  registrationOpen: boolean;
  participantCount: number;
}

/** Latest APPROVED version of one asset type. */
async function approvedAsset(
  eventId: string,
  type: "landing_page_content" | "faq",
): Promise<string | null> {
  const [row] = await db
    .select({ body: generatedAssets.body })
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.eventId, eventId),
        eq(generatedAssets.type, type),
        eq(generatedAssets.reviewStatus, "approved"),
      ),
    )
    .orderBy(desc(generatedAssets.version))
    .limit(1);
  return row?.body?.trim() || null;
}

/** Parse the landing copy's `## Heading` sections into something renderable. */
export function parseLandingCopy(copy: string): {
  headline: string | null;
  summary: string | null;
  sections: { heading: string; bullets: string[] }[];
} {
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of copy.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1], lines: [] });
      continue;
    }
    if (sections.length > 0) sections[sections.length - 1].lines.push(line);
  }

  const take = (name: string) =>
    sections.find((s) => s.heading.toLowerCase() === name)?.lines.join("\n").trim() ||
    null;

  const toBullets = (lines: string[]) =>
    lines
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter((l) => l.length > 0);

  return {
    headline: take("headline"),
    summary: take("summary"),
    sections: sections
      .filter((s) => !["headline", "summary"].includes(s.heading.toLowerCase()))
      .map((s) => ({ heading: s.heading, bullets: toBullets(s.lines) }))
      .filter((s) => s.bullets.length > 0),
  };
}

/** Parse the FAQ's `### Question` / answer pairs. */
export function parseFaq(copy: string): FaqEntry[] {
  const entries: { question: string; lines: string[] }[] = [];
  for (const line of copy.split(/\r?\n/)) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      entries.push({ question: heading[1], lines: [] });
      continue;
    }
    if (entries.length > 0) entries[entries.length - 1].lines.push(line);
  }
  return entries
    .map((e) => ({ question: e.question, answer: e.lines.join("\n").trim() }))
    .filter((e) => e.answer !== "");
}

export async function loadLandingPage(slug: string): Promise<LandingPageView | null> {
  const [event] = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      status: events.status,
      topicSummary: events.topicSummary,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      locationName: events.locationName,
      locationAddress: events.locationAddress,
      organizationName: organizations.name,
      sponsorApplicationId: events.sponsorApplicationId,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .where(eq(events.slug, slug))
    .limit(1);
  if (!event) return null;

  const [copy, faqCopy, application, [countRow]] = await Promise.all([
    approvedAsset(event.id, "landing_page_content"),
    approvedAsset(event.id, "faq"),
    event.sponsorApplicationId
      ? db
          .select({
            painPoints: sponsorApplications.painPoints,
            goalsNeeds: sponsorApplications.goalsNeeds,
          })
          .from(sponsorApplications)
          .where(eq(sponsorApplications.id, event.sponsorApplicationId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ n: count() })
      .from(participants)
      .where(eq(participants.eventId, event.id)),
  ]);

  const parsed = copy ? parseLandingCopy(copy) : null;

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    organizationName: event.organizationName,
    // Falling back to the sponsor's own words is better than an empty page —
    // and it's honest: it's what they told us the problem was.
    headline: parsed?.headline ?? event.title,
    summary:
      parsed?.summary ??
      event.topicSummary ??
      application?.painPoints ??
      "",
    sections: parsed?.sections ?? [],
    faq: faqCopy ? parseFaq(faqCopy) : [],
    weekendLabel: event.confirmedFridayKickoffAt
      ? formatWeekendLabel(event.confirmedFridayKickoffAt)
      : null,
    scheduleLines: event.confirmedFridayKickoffAt
      ? describeSchedule(event.confirmedFridayKickoffAt)
      : [],
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    registrationOpen: isRegistrationOpen(event.status),
    participantCount: Number(countRow?.n ?? 0),
  };
}

/** Public events for the `/rogue-raise` hub. */
export async function listPublicEvents(): Promise<
  { slug: string; title: string; organizationName: string; weekendLabel: string | null; registrationOpen: boolean }[]
> {
  const rows = await db
    .select({
      slug: events.slug,
      title: events.title,
      status: events.status,
      confirmedFridayKickoffAt: events.confirmedFridayKickoffAt,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .orderBy(desc(events.createdAt));

  return rows
    .filter((row) => isPublicEvent(row.status))
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      organizationName: row.organizationName,
      weekendLabel: row.confirmedFridayKickoffAt
        ? formatWeekendLabel(row.confirmedFridayKickoffAt)
        : null,
      registrationOpen: isRegistrationOpen(row.status),
    }));
}

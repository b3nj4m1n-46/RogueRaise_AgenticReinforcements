/**
 * Read model for judging (PRD §7.2) and results (PRD §7.3).
 *
 * DELIBERATELY NOT a `"use server"` module — exports there become POST
 * endpoints, and a reader keyed only on an event id would be a way to read every
 * team's scores without ever presenting a judge token. These are called from
 * Server Components that have already established access.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  awardCategories,
  criteria,
  events,
  judgeScores,
  judges,
  participants,
  submissions,
  teamMemberships,
  teams,
} from "../db/schema";
import {
  aggregate,
  findTies,
  type AggregateRow,
  type Criterion,
  type ScoreMap,
} from "./scoring";

/** Judging is open while the event is in `judging`. */
export function isJudgingOpen(status: string): boolean {
  return status === "judging";
}

export interface SubmissionForJudge {
  id: string;
  teamName: string;
  projectSummary: string;
  repoUrl: string;
  pitchMaterialsUrl: string | null;
  members: string[];
  /** This judge's saved card, if they've started one. */
  card: { scores: ScoreMap; notes: string; isDraft: boolean } | null;
}

async function loadCriteria(eventId: string): Promise<Criterion[]> {
  const rows = await db
    .select({ id: criteria.id, label: criteria.label, weight: criteria.weight })
    .from(criteria)
    .where(eq(criteria.eventId, eventId))
    .orderBy(criteria.sortOrder);
  return rows;
}

/** `submissionId → member names`, one grouped query rather than an N+1. */
async function membersBySubmission(
  submissionRows: { id: string; teamId: string }[],
): Promise<Map<string, string[]>> {
  const teamIds = submissionRows.map((s) => s.teamId);
  if (teamIds.length === 0) return new Map();

  const rows = await db
    .select({
      teamId: teamMemberships.teamId,
      firstName: participants.firstName,
      lastName: participants.lastName,
    })
    .from(teamMemberships)
    .innerJoin(participants, eq(teamMemberships.participantId, participants.id))
    .where(inArray(teamMemberships.teamId, teamIds));

  const byTeam = new Map<string, string[]>();
  for (const row of rows) {
    const names = byTeam.get(row.teamId) ?? [];
    names.push(`${row.firstName} ${row.lastName}`.trim());
    byTeam.set(row.teamId, names);
  }
  return new Map(
    submissionRows.map((s) => [s.id, (byTeam.get(s.teamId) ?? []).sort()]),
  );
}

export interface JudgingPacket {
  criteria: Criterion[];
  submissions: SubmissionForJudge[];
}

/** Everything one judge needs to score, plus whatever they've already saved. */
export async function loadJudgingPacket(input: {
  eventId: string;
  judgeId: string;
}): Promise<JudgingPacket> {
  const [criteriaRows, submissionRows] = await Promise.all([
    loadCriteria(input.eventId),
    db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, input.eventId))
      .orderBy(submissions.submittedAt),
  ]);

  const submissionIds = submissionRows.map((s) => s.id);
  const [members, cards] = await Promise.all([
    membersBySubmission(submissionRows),
    submissionIds.length
      ? db
          .select()
          .from(judgeScores)
          .where(
            and(
              eq(judgeScores.judgeId, input.judgeId),
              inArray(judgeScores.submissionId, submissionIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const cardBySubmission = new Map(cards.map((c) => [c.submissionId, c]));

  return {
    criteria: criteriaRows,
    submissions: submissionRows.map((row) => {
      const card = cardBySubmission.get(row.id);
      return {
        id: row.id,
        teamName: row.teamName,
        projectSummary: row.projectSummary,
        repoUrl: row.repoUrl,
        pitchMaterialsUrl: row.pitchMaterialsUrl,
        members: members.get(row.id) ?? [],
        card: card
          ? {
              scores: (card.scores as ScoreMap | null) ?? {},
              notes: card.notes ?? "",
              isDraft: card.isDraft,
            }
          : null,
      };
    }),
  };
}

// --- Admin results ----------------------------------------------------------

export interface JudgeProgress {
  judgeId: string;
  judgeName: string;
  submitted: number;
  drafted: number;
}

export interface ResultsView {
  event: { id: string; title: string; status: string };
  criteria: Criterion[];
  rows: AggregateRow[];
  /** Groups sharing an average — surfaced for an admin to break (PRD §7.3). */
  ties: AggregateRow[][];
  judgeProgress: JudgeProgress[];
  submissionCount: number;
  awards: {
    id: string;
    label: string;
    description: string | null;
    criterionId: string | null;
    winningSubmissionId: string | null;
    winningTeamName: string | null;
    announcedAt: string | null;
  }[];
}

export async function loadResults(eventId: string): Promise<ResultsView | null> {
  const [event] = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;

  const [criteriaRows, submissionRows, judgeRows, awardRows] = await Promise.all([
    loadCriteria(eventId),
    db.select().from(submissions).where(eq(submissions.eventId, eventId)),
    db.select().from(judges).where(eq(judges.eventId, eventId)).orderBy(judges.createdAt),
    db
      .select()
      .from(awardCategories)
      .where(eq(awardCategories.eventId, eventId))
      .orderBy(awardCategories.createdAt),
  ]);

  const submissionIds = submissionRows.map((s) => s.id);
  const cards = submissionIds.length
    ? await db
        .select()
        .from(judgeScores)
        .where(inArray(judgeScores.submissionId, submissionIds))
    : [];

  const judgeNames = new Map(judgeRows.map((j) => [j.id, j.name]));
  const teamNames = new Map(submissionRows.map((s) => [s.id, s.teamName]));

  // Only SUBMITTED cards count. A draft is a judge still thinking; folding it
  // into the standings would show a number that changes under everyone's feet.
  const submitted = cards.filter((c) => !c.isDraft && c.finalScore !== null);

  const rows = aggregate(
    criteriaRows,
    submissionRows.map((submission) => ({
      submissionId: submission.id,
      teamName: submission.teamName,
      judgeScores: submitted
        .filter((c) => c.submissionId === submission.id)
        .map((c) => ({
          judgeId: c.judgeId,
          judgeName: judgeNames.get(c.judgeId) ?? "Judge",
          finalScore: Number(c.finalScore),
          scores: (c.scores as ScoreMap | null) ?? {},
        })),
    })),
  );

  return {
    event,
    criteria: criteriaRows,
    rows,
    ties: findTies(rows),
    submissionCount: submissionRows.length,
    judgeProgress: judgeRows.map((judge) => {
      const own = cards.filter((c) => c.judgeId === judge.id);
      return {
        judgeId: judge.id,
        judgeName: judge.name,
        submitted: own.filter((c) => !c.isDraft).length,
        drafted: own.filter((c) => c.isDraft).length,
      };
    }),
    awards: awardRows.map((award) => ({
      id: award.id,
      label: award.label,
      description: award.description,
      criterionId: award.criterionId,
      winningSubmissionId: award.winningSubmissionId,
      winningTeamName: award.winningSubmissionId
        ? (teamNames.get(award.winningSubmissionId) ?? null)
        : null,
      announcedAt: award.announcedAt?.toISOString() ?? null,
    })),
  };
}

/** Team + members for the winners board and the handoff portal. */
export async function listSubmissionsWithTeams(eventId: string) {
  const rows = await db
    .select({
      id: submissions.id,
      teamId: submissions.teamId,
      teamName: submissions.teamName,
      projectSummary: submissions.projectSummary,
      repoUrl: submissions.repoUrl,
      pitchMaterialsUrl: submissions.pitchMaterialsUrl,
      linesOfCode: submissions.linesOfCode,
      submissionCategory: submissions.submissionCategory,
      categorySummary: submissions.categorySummary,
      stewardship: submissions.stewardship,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(teams, eq(submissions.teamId, teams.id))
    .where(eq(submissions.eventId, eventId))
    .orderBy(submissions.submittedAt);

  const members = await membersBySubmission(rows);
  return rows.map((row) => ({
    ...row,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    members: members.get(row.id) ?? [],
  }));
}

/** Has this judge finished every submission? Drives the "you're done" banner. */
export async function judgeIsFinished(input: {
  eventId: string;
  judgeId: string;
}): Promise<boolean> {
  const rows = await db
    .select({ id: submissions.id, isDraft: judgeScores.isDraft })
    .from(submissions)
    .leftJoin(
      judgeScores,
      and(
        eq(judgeScores.submissionId, submissions.id),
        eq(judgeScores.judgeId, input.judgeId),
      ),
    )
    .where(eq(submissions.eventId, input.eventId));
  return rows.length > 0 && rows.every((r) => r.isDraft === false);
}

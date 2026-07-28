/**
 * Read model for the stakeholder handoff portal (PRD §8).
 *
 * DELIBERATELY NOT a `"use server"` module — this reads participant contact
 * details and judges' evaluations, and an export here would become a POST
 * endpoint keyed on an event id. Callers must have redeemed a stakeholder token
 * first; that is enforced by the page, and this module is only reachable from
 * Server Components.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  awardCategories,
  criteria,
  generatedAssets,
  judgeScores,
  judges,
  participants,
  submissions,
  teamMemberships,
} from "../db/schema";
import { computeFinalScore, type Criterion, type ScoreMap } from "../judging/scoring";

export interface PortalMember {
  name: string;
  email: string;
  githubUsername: string | null;
}

export interface PortalEvaluation {
  judgeName: string;
  finalScore: number | null;
  perCriterion: { label: string; score: number | null }[];
  /** The judge's note to the team, when they left one. */
  notes: string | null;
}

export interface PortalSubmission {
  id: string;
  teamName: string;
  projectSummary: string;
  repoUrl: string;
  /** GitHub's own zip of the default branch — no extra plumbing needed. */
  downloadUrl: string | null;
  pitchMaterialsUrl: string | null;
  linesOfCode: number | null;
  category: string | null;
  categorySummary: string | null;
  stewardship: string;
  members: PortalMember[];
  evaluations: PortalEvaluation[];
  averageScore: number | null;
  awards: string[];
}

export interface PortalView {
  stats: {
    submissionCount: number;
    /** Sum of what we could count. Null when nothing could be counted at all. */
    totalLinesOfCode: number | null;
    /** How many repos the count actually covers, so the figure can be caveated. */
    countedRepos: number;
    categories: { label: string; count: number }[];
  };
  /** The categorizer's prose, once an admin has approved it. */
  summaryDocument: string | null;
  submissions: PortalSubmission[];
  awards: { label: string; teamName: string | null; announcedAt: string | null }[];
}

/** GitHub serves a zip of the default branch at this path. */
function downloadUrlFor(repoUrl: string): string | null {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(
    repoUrl.trim(),
  );
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}/archive/refs/heads/HEAD.zip`;
}

/** The caller already holds the event from the token, so this returns only
 * what the portal itself needs to render. */
export async function loadPortal(eventId: string): Promise<PortalView> {
  const [submissionRows, criteriaRows, judgeRows, awardRows, summaryRows] =
    await Promise.all([
      db
        .select()
        .from(submissions)
        .where(eq(submissions.eventId, eventId))
        .orderBy(submissions.submittedAt),
      db
        .select({ id: criteria.id, label: criteria.label, weight: criteria.weight })
        .from(criteria)
        .where(eq(criteria.eventId, eventId))
        .orderBy(criteria.sortOrder),
      db.select().from(judges).where(eq(judges.eventId, eventId)),
      db
        .select()
        .from(awardCategories)
        .where(eq(awardCategories.eventId, eventId))
        .orderBy(awardCategories.createdAt),
      db
        .select()
        .from(generatedAssets)
        .where(eq(generatedAssets.eventId, eventId))
        .orderBy(generatedAssets.version),
    ]);

  const submissionIds = submissionRows.map((s) => s.id);
  const teamIds = submissionRows.map((s) => s.teamId);

  const [memberRows, scoreRows] = await Promise.all([
    teamIds.length
      ? db
          .select({
            teamId: teamMemberships.teamId,
            firstName: participants.firstName,
            lastName: participants.lastName,
            email: participants.email,
            githubUsername: participants.githubUsername,
          })
          .from(teamMemberships)
          .innerJoin(
            participants,
            eq(teamMemberships.participantId, participants.id),
          )
          .where(inArray(teamMemberships.teamId, teamIds))
      : [],
    submissionIds.length
      ? db
          .select()
          .from(judgeScores)
          .where(inArray(judgeScores.submissionId, submissionIds))
      : [],
  ]);

  const membersByTeam = new Map<string, PortalMember[]>();
  for (const row of memberRows) {
    const list = membersByTeam.get(row.teamId) ?? [];
    list.push({
      name: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      githubUsername: row.githubUsername,
    });
    membersByTeam.set(row.teamId, list);
  }

  const judgeNames = new Map(judgeRows.map((j) => [j.id, j.name]));
  const criterionList: Criterion[] = criteriaRows;

  // Only ANNOUNCED awards reach the portal. An assigned-but-unannounced winner
  // is a decision White Rabbit hasn't made public yet, and the stakeholder
  // learning it here first would pre-empt the room.
  const announced = awardRows.filter((a) => a.announcedAt !== null);
  const awardsBySubmission = new Map<string, string[]>();
  for (const award of announced) {
    if (!award.winningSubmissionId) continue;
    const list = awardsBySubmission.get(award.winningSubmissionId) ?? [];
    list.push(award.label);
    awardsBySubmission.set(award.winningSubmissionId, list);
  }

  // Latest APPROVED summary only — the categorizer's prose goes in front of the
  // sponsoring organization, so it passes the same review gate as everything
  // else that leaves the building.
  const approvedSummary = summaryRows
    .filter((a) => a.type === "submission_summary" && a.reviewStatus === "approved")
    .at(-1);

  const portalSubmissions: PortalSubmission[] = submissionRows.map((row) => {
    const cards = scoreRows.filter((c) => c.submissionId === row.id && !c.isDraft);
    const finals = cards
      .map((c) => (c.finalScore === null ? null : Number(c.finalScore)))
      .filter((n): n is number => n !== null);

    return {
      id: row.id,
      teamName: row.teamName,
      projectSummary: row.projectSummary,
      repoUrl: row.repoUrl,
      downloadUrl: downloadUrlFor(row.repoUrl),
      pitchMaterialsUrl: row.pitchMaterialsUrl,
      linesOfCode: row.linesOfCode,
      category: row.submissionCategory,
      categorySummary: row.categorySummary,
      stewardship: row.stewardship,
      members: (membersByTeam.get(row.teamId) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      evaluations: cards.map((card) => {
        const scores = (card.scores as ScoreMap | null) ?? {};
        return {
          judgeName: judgeNames.get(card.judgeId) ?? "Judge",
          finalScore:
            card.finalScore === null
              ? computeFinalScore(criterionList, scores)
              : Number(card.finalScore),
          perCriterion: criterionList.map((criterion) => ({
            label: criterion.label,
            score: scores[criterion.id] ?? null,
          })),
          notes: card.notes,
        };
      }),
      averageScore: finals.length
        ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 100) / 100
        : null,
      awards: awardsBySubmission.get(row.id) ?? [],
    };
  });

  const counted = portalSubmissions.filter((s) => s.linesOfCode !== null);
  const categoryCounts = new Map<string, number>();
  for (const submission of portalSubmissions) {
    if (!submission.category) continue;
    categoryCounts.set(
      submission.category,
      (categoryCounts.get(submission.category) ?? 0) + 1,
    );
  }

  return {
    stats: {
      submissionCount: portalSubmissions.length,
      totalLinesOfCode: counted.length
        ? counted.reduce((sum, s) => sum + (s.linesOfCode ?? 0), 0)
        : null,
      countedRepos: counted.length,
      categories: [...categoryCounts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    },
    summaryDocument: approvedSummary?.body ?? null,
    submissions: portalSubmissions,
    awards: announced.map((award) => ({
      label: award.label,
      teamName: award.winningSubmissionId
        ? (submissionRows.find((s) => s.id === award.winningSubmissionId)?.teamName ??
          null)
        : null,
      announcedAt: award.announcedAt?.toISOString() ?? null,
    })),
  };
}

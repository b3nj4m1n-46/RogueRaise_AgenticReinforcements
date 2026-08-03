/**
 * Submission categorizer & LOC (PRD §11.2, feeding the portal dashboard §8.1).
 *
 * The only agent whose primary output is numbers rather than prose. The split
 * matters: a line count is a fact about a repository and applies itself, while
 * the account of the weekend goes in front of the sponsoring organization and
 * therefore passes the same admin review gate as everything else that leaves
 * the building.
 *
 * Two things it deliberately does not do:
 *
 *   - **It does not read the code.** GitHub gives us a language breakdown and a
 *     line count; the categorization comes from those plus what the team wrote.
 *     The prompt says so, and the portal labels the number for what it is.
 *   - **It does not invent a number it couldn't get.** A repo that is private,
 *     rate-limited, or still being crunched by GitHub yields `null`, which the
 *     portal shows as "not counted". Writing zero would tell a sponsor a team
 *     produced nothing.
 */
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { events, organizations, sponsorApplications, submissions } from "../../db/schema";
import { fetchRepoStats } from "../../integrations/github";
import type { AgentHandler, SubmissionStat } from "../registry";
import {
  buildCategorizerPrompt,
  parseCategorization,
  type CategorizerSubmission,
} from "./submission-categorizer-prompts";

export const submissionCategorizerHandler: AgentHandler = async (ctx) => {
  const rows = await db
    .select({
      id: submissions.id,
      teamName: submissions.teamName,
      projectSummary: submissions.projectSummary,
      repoUrl: submissions.repoUrl,
    })
    .from(submissions)
    .where(eq(submissions.eventId, ctx.event.id))
    .orderBy(submissions.submittedAt);

  if (rows.length === 0) {
    throw new Error(
      "No projects have been submitted for this event, so there is nothing to categorize.",
    );
  }

  ctx.log(`Reading repository statistics for ${rows.length} project(s)…`);
  // Concurrent: each is two GitHub calls with its own timeout, and one slow
  // repo shouldn't hold up the rest.
  const stats = await Promise.all(
    rows.map(async (row) => ({ row, stats: await fetchRepoStats(row.repoUrl) })),
  );

  const counted = stats.filter((s) => s.stats.linesOfCode !== null).length;
  ctx.log(
    counted === rows.length
      ? `Counted lines in all ${rows.length} repositories.`
      : `Counted lines in ${counted} of ${rows.length} repositories. The rest are private, rate-limited, or still being computed by GitHub — re-running this later will pick up the ones that were merely still computing.`,
  );

  const brief = await loadBrief(ctx.event.id);
  const forPrompt: CategorizerSubmission[] = stats.map(({ row, stats: s }) => ({
    id: row.id,
    teamName: row.teamName,
    projectSummary: row.projectSummary,
    repoUrl: row.repoUrl,
    languages: s.languages,
    linesOfCode: s.linesOfCode,
  }));

  const { system, prompt } = buildCategorizerPrompt({
    ...brief,
    submissions: forPrompt,
  });

  ctx.log("Categorizing what got built…");
  const result = await ctx.ai.generate({
    system: ctx.additionalInstructions
      ? `${system}\n\nADDITIONAL INSTRUCTIONS FROM WHITE RABBIT (follow these over the general guidance above):\n${ctx.additionalInstructions}`
      : system,
    prompt,
    maxOutputTokens: 3000,
  });

  const parsed = parseCategorization(result.text);
  // Only ids we actually asked about, so a hallucinated id can't touch a row.
  const known = new Map(rows.map((r) => [r.id, r.teamName]));
  const categorized = parsed.perSubmission.filter((p) => known.has(p.id));
  const byId = new Map(categorized.map((p) => [p.id, p]));

  if (categorized.length < rows.length) {
    ctx.log(
      `Categorized ${categorized.length} of ${rows.length} — the rest keep their line counts and are left uncategorized rather than guessed at.`,
    );
  }

  // Every submission gets its stat row: the line count stands even when the
  // model didn't produce a usable block for it.
  const submissionStats: SubmissionStat[] = stats.map(({ row, stats: s }) => {
    const match = byId.get(row.id);
    return {
      submissionId: row.id,
      linesOfCode: s.linesOfCode,
      category: match?.category ?? null,
      categorySummary: match?.summary || null,
    };
  });

  const totalLines = submissionStats.reduce(
    (sum, stat) => sum + (stat.linesOfCode ?? 0),
    0,
  );

  return {
    assets: [
      {
        type: "submission_summary",
        title: `What got built — ${brief.organizationName}`,
        body: buildSummaryDocument({
          overview: parsed.overview,
          organizationName: brief.organizationName,
          rows: submissionStats.map((stat) => ({
            teamName: known.get(stat.submissionId) ?? "Team",
            category: stat.category,
            summary: stat.categorySummary,
            linesOfCode: stat.linesOfCode,
          })),
          totalLines,
          countedRepos: counted,
          totalRepos: rows.length,
        }),
      },
    ],
    submissionStats,
    costTokens: result.usage.totalTokens,
    summary: `Categorized ${categorized.length} of ${rows.length} project(s); counted ${totalLines.toLocaleString("en-US")} lines across ${counted} repository/ies.`,
  };
};

async function loadBrief(eventId: string): Promise<{
  eventTitle: string;
  organizationName: string;
  painPoints: string;
  goalsNeeds: string;
}> {
  const [row] = await db
    .select({
      title: events.title,
      organizationName: organizations.name,
      painPoints: sponsorApplications.painPoints,
      goalsNeeds: sponsorApplications.goalsNeeds,
    })
    .from(events)
    .innerJoin(organizations, eq(events.orgId, organizations.id))
    .leftJoin(
      sponsorApplications,
      eq(events.sponsorApplicationId, sponsorApplications.id),
    )
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) throw new Error("Event not found.");

  return {
    eventTitle: row.title,
    organizationName: row.organizationName,
    painPoints: row.painPoints ?? "",
    goalsNeeds: row.goalsNeeds ?? "",
  };
}

/**
 * The reviewable document. Assembled from the parsed pieces rather than storing
 * the raw reply, so what an admin reads is the same shape whatever the model
 * returned — and the caveat about what a line count means travels with it.
 */
function buildSummaryDocument(input: {
  overview: string;
  organizationName: string;
  rows: {
    teamName: string;
    category: string | null;
    summary: string | null;
    linesOfCode: number | null;
  }[];
  totalLines: number;
  countedRepos: number;
  totalRepos: number;
}): string {
  const lines = [`# What got built — ${input.organizationName}`, ""];

  if (input.overview) lines.push(input.overview, "");

  lines.push(
    `**${input.totalRepos} project${input.totalRepos === 1 ? "" : "s"} submitted.**`,
  );

  // "0 lines of code" would read as "they wrote nothing", which is the one
  // thing the null handling exists to prevent. When nothing could be counted,
  // say that instead of printing a zero.
  if (input.countedRepos === 0) {
    lines.push(
      "We couldn't count the lines of code: the repositories are private, or GitHub hadn't finished computing their statistics. Re-running this will pick up any that were still being computed.",
    );
  } else {
    lines.push(
      input.countedRepos === input.totalRepos
        ? `**${input.totalLines.toLocaleString("en-US")} lines of code** across all of them.`
        : `**${input.totalLines.toLocaleString("en-US")} lines of code** across the ${input.countedRepos} repositor${input.countedRepos === 1 ? "y" : "ies"} we could count. The others are private, or GitHub hadn't finished computing their statistics.`,
      "",
      "_Line counts are net lines currently in each repository, from GitHub's own history. They include everything committed — configuration, generated files, and dependencies a team checked in — so they describe scale, not effort._",
    );
  }

  lines.push("", "## The projects", "");

  for (const row of input.rows) {
    lines.push(`### ${row.teamName}`);
    if (row.category) lines.push(`**${row.category}**`);
    if (row.summary) lines.push(row.summary);
    lines.push(
      row.linesOfCode === null
        ? "_Lines not counted._"
        : `_${row.linesOfCode.toLocaleString("en-US")} lines._`,
      "",
    );
  }

  return lines.join("\n");
}

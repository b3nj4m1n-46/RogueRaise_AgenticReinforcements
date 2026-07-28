/**
 * Prompt for the submission categorizer (PRD §11.2, feeding §8.1).
 *
 * Kept separate from the handler so the prompt can be read and edited without
 * scrolling past API plumbing, matching the other agents.
 *
 * The output contract is deliberately line-oriented rather than JSON: this
 * model output is parsed, and a `## SUBMISSION:` marker per project degrades
 * gracefully — a malformed block loses one categorization instead of throwing
 * away the whole run, which JSON parsing would.
 */

export interface CategorizerSubmission {
  id: string;
  teamName: string;
  projectSummary: string;
  repoUrl: string;
  /** GitHub's byte-per-language breakdown, when it answered. */
  languages: Record<string, number> | null;
  linesOfCode: number | null;
}

export interface CategorizerBrief {
  eventTitle: string;
  organizationName: string;
  painPoints: string;
  goalsNeeds: string;
  submissions: CategorizerSubmission[];
}

function describeLanguages(languages: Record<string, number> | null): string {
  if (!languages) return "language breakdown unavailable";
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  if (total === 0) return "language breakdown unavailable";
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, bytes]) => `${name} ${Math.round((bytes / total) * 100)}%`)
    .join(", ");
}

export function buildCategorizerPrompt(brief: CategorizerBrief): {
  system: string;
  prompt: string;
} {
  const system = [
    "You are helping White Rabbit, a small studio in Ashland, Oregon, report back to the organization that sponsored a Rogue Raise — a weekend where volunteers build working software for a real community problem.",
    "",
    "Your job is to categorize what got built and write a short, plain account of it for the sponsoring organization's staff. They are not engineers. They are trying to work out what they now have and what they could actually use.",
    "",
    "Rules:",
    "- Categorize from what the team WROTE about their project and the languages in their repository. You cannot read the code. Do not pretend to have.",
    "- A category is two or three words a non-engineer would use: 'Data dashboard', 'Intake form', 'Mobile app', 'Reporting tool', 'Integration script'. Not a framework name.",
    "- The per-project summary is one or two sentences, in plain language, about what it does and who would use it. No adjectives about quality — you have not seen it run, and judging is the judges' job.",
    "- The overview names patterns honestly, including gaps. If four teams built the same thing and nobody touched the hardest part of the problem, say so — that is the single most useful sentence you can write for a sponsor.",
    "- Never invent a feature that isn't in the team's own description.",
    "",
    "Format your reply EXACTLY like this, with no preamble:",
    "",
    "## OVERVIEW",
    "<two to four sentences for the sponsor: what the weekend produced overall, what patterns showed up, and what was left untouched>",
    "",
    "## SUBMISSION: <submission id, copied exactly>",
    "CATEGORY: <two or three words>",
    "<one or two sentences of plain-language summary>",
    "",
    "Repeat the `## SUBMISSION:` block once per project, in the order given.",
  ].join("\n");

  const projects = brief.submissions
    .map((submission) =>
      [
        `### ${submission.teamName}`,
        `Submission id: ${submission.id}`,
        `Repository: ${submission.repoUrl}`,
        `Languages: ${describeLanguages(submission.languages)}`,
        `Lines of code: ${submission.linesOfCode ?? "not counted"}`,
        "What the team said they built:",
        submission.projectSummary,
      ].join("\n"),
    )
    .join("\n\n");

  const prompt = [
    `Event: ${brief.eventTitle}`,
    `Sponsoring organization: ${brief.organizationName}`,
    "",
    "The problem they brought to us:",
    brief.painPoints || "(not recorded)",
    "",
    "What they said they needed:",
    brief.goalsNeeds || "(not recorded)",
    "",
    `${brief.submissions.length} project(s) were submitted:`,
    "",
    projects,
  ].join("\n");

  return { system, prompt };
}

export interface ParsedCategorization {
  overview: string;
  perSubmission: { id: string; category: string; summary: string }[];
}

const SUBMISSION_HEADING = /^##\s+SUBMISSION\s*:\s*(.+?)\s*$/i;
const OVERVIEW_HEADING = /^##\s+OVERVIEW\s*$/i;
const CATEGORY_LINE = /^CATEGORY\s*:\s*(.+?)\s*$/i;

/**
 * Splits the reply on its explicit markers — the same house rule the other
 * agents use. Anything before the first recognized heading is ignored rather
 * than guessed at, and a block missing its CATEGORY line is dropped instead of
 * writing a nonsense category onto a submission.
 */
export function parseCategorization(text: string): ParsedCategorization {
  const lines = text.split(/\r?\n/);
  const overview: string[] = [];
  const perSubmission: ParsedCategorization["perSubmission"] = [];

  let mode: "none" | "overview" | "submission" = "none";
  let currentId = "";
  let currentCategory = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (mode === "submission" && currentId && currentCategory) {
      perSubmission.push({
        id: currentId,
        category: currentCategory,
        summary: currentBody.join("\n").trim(),
      });
    }
    currentId = "";
    currentCategory = "";
    currentBody = [];
  };

  for (const line of lines) {
    const submissionMatch = SUBMISSION_HEADING.exec(line);
    if (submissionMatch) {
      flush();
      mode = "submission";
      currentId = submissionMatch[1].trim();
      continue;
    }
    if (OVERVIEW_HEADING.test(line)) {
      flush();
      mode = "overview";
      continue;
    }
    if (mode === "overview") {
      overview.push(line);
      continue;
    }
    if (mode === "submission") {
      const categoryMatch = CATEGORY_LINE.exec(line);
      if (categoryMatch && !currentCategory) {
        currentCategory = categoryMatch[1].trim();
        continue;
      }
      currentBody.push(line);
    }
  }
  flush();

  return { overview: overview.join("\n").trim(), perSubmission };
}

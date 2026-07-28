/**
 * Prompts for the judge invitation agent (PRD §5.3.3). Pure, so what the agent
 * is told is testable without a model.
 *
 * One document containing every judge's letter, split on an explicit
 * `## JUDGE: <email>` marker — the same contract the example-PRD splitter uses,
 * and for the same reason: several assets of one type would look like revisions
 * of each other under per-type versioning, and splitting on incidental structure
 * shreds documents that don't follow it.
 */

export interface JudgeInvitationBrief {
  eventTitle: string;
  organizationName: string;
  painPoints: string;
  goalsNeeds: string;
  /** Expanded canonical schedule lines. */
  scheduleLines: string[];
  weekendLabel: string | null;
  locationName: string | null;
  locationAddress: string | null;
  criteria: { label: string; description: string | null; weight: string | null }[];
  judges: { name: string; email: string }[];
}

export const JUDGE_MARKER = /^##\s+JUDGE\s*:\s*(.+?)\s*$/i;

function list(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "_Not yet set._";
}

export function buildJudgeInvitationPrompt(brief: JudgeInvitationBrief): {
  system: string;
  prompt: string;
} {
  const system = `You are writing for White Rabbit's "Rogue Raise" — a weekend community build event in Ashland, Oregon, modelled on a barn raising. You are drafting the invitation letters sent to the people asked to JUDGE the work.

Write one letter per judge, addressed to them by name. Each letter must cover:
- what this Rogue Raise is and what problem it's building around,
- the full schedule, including exactly when they are needed (Sunday afternoon: pitches at 4:00 PM, results at 6:00 PM),
- what is expected of a judge — roughly how long it takes and what they'll be asked to do,
- the evaluative criteria they'll be scoring against,
- an explicit invitation to ask questions about the criteria themselves, since the criteria are the sponsor's and are still open to discussion.

Do NOT include the link to their form — it is appended automatically, and it differs per judge.

Warm, plain, specific. No marketing voice. Short paragraphs. These are volunteers being asked for a Sunday afternoon.

FORMAT, exactly: begin each letter with a line of the form \`## JUDGE: <their email address>\` and nothing else on that line. The letters are split into separate emails on that marker, so a letter without it will be merged into the previous judge's. Write no preamble before the first marker.`;

  const prompt = [
    `# Brief: ${brief.eventTitle}`,
    "",
    `Sponsoring organization: ${brief.organizationName}`,
    brief.weekendLabel ? `Weekend: ${brief.weekendLabel}` : "",
    [brief.locationName, brief.locationAddress].filter(Boolean).join(", ")
      ? `Location: ${[brief.locationName, brief.locationAddress].filter(Boolean).join(", ")}`
      : "",
    "",
    "## The problem being built around",
    "",
    brief.painPoints.trim() || "_Not described._",
    "",
    "## What a good outcome looks like to the sponsor",
    "",
    brief.goalsNeeds.trim() || "_Not described._",
    "",
    "## Schedule",
    "",
    list(brief.scheduleLines),
    "",
    "## Evaluative criteria",
    "",
    list(
      brief.criteria.map((c) =>
        [c.label, c.description, c.weight ? `(weight ${c.weight})` : ""]
          .filter(Boolean)
          .join(" — "),
      ),
    ),
    "",
    "## Judges to write to",
    "",
    list(brief.judges.map((j) => `${j.name} <${j.email}>`)),
  ]
    .filter((part) => part !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { system, prompt };
}

export interface JudgeLetter {
  email: string;
  body: string;
}

/**
 * Split the drafted document into one letter per judge. A document with no
 * marker yields nothing rather than one letter addressed to everybody — sending
 * the wrong person's letter is worse than sending none.
 */
export function splitJudgeLetters(document: string): JudgeLetter[] {
  const lines = document.split(/\r?\n/);
  const letters: JudgeLetter[] = [];

  for (const line of lines) {
    const marker = JUDGE_MARKER.exec(line);
    if (marker) {
      letters.push({ email: marker[1].replace(/[<>]/g, "").trim(), body: "" });
      continue;
    }
    if (letters.length > 0) {
      letters[letters.length - 1].body += `${line}\n`;
    }
  }

  return letters
    .map((letter) => ({ ...letter, body: letter.body.trim() }))
    .filter((letter) => letter.email !== "" && letter.body !== "");
}

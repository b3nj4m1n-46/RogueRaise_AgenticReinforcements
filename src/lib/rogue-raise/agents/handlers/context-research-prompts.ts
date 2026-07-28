/**
 * Prompt construction for the context-research agent (PRD §5.3.1).
 *
 * Pure and DB-free so the prompts are testable without a model or a database —
 * what an agent is *told* matters at least as much as which model runs it, and
 * this is the part worth pinning in tests.
 *
 * One prompt per document rather than one prompt asking for four: a single weak
 * document can then be re-run without disturbing the other three, and each
 * prompt can be specific about the shape it wants.
 */

/** Everything the agent is allowed to know about an event. Assembled from the intake. */
export interface EventBrief {
  organizationName: string;
  eventTitle: string;
  /** From the sponsor application. */
  painPoints: string;
  goalsNeeds: string;
  /** From the intake. */
  supportingContext: string;
  technicalStack: string;
  technicalTags: string[];
  attachmentNames: string[];
  /**
   * What technical sponsors are PROVIDING, in words. Never a credential — the
   * loader passes descriptions only, and the asset writer refuses secrets as a
   * backstop (PRD §11).
   */
  technicalSponsors: { name: string; offering: string | null; status: string | null }[];
  evaluativeCriteria: { label: string; description: string | null }[];
  /** Human-readable weekend, when one is confirmed. */
  confirmedWeekend: string | null;
}

const HOUSE_STYLE = `You are writing for White Rabbit's "Rogue Raise" — a weekend community build event modelled on a barn raising, run in Ashland, Oregon. Participants are volunteer builders who arrive Friday evening and ship something real by Sunday afternoon.

Write plainly and concretely. No marketing voice, no filler, no restating the brief back. Prefer specifics from the brief over generalities. If the brief doesn't tell you something, say what's unknown rather than inventing it — a stated gap is useful to the team, a confident guess is not.

Never include API keys, tokens, passwords, or any other credential. Where a credential is needed, describe how to obtain it and where it goes (an environment variable name), never the value.`;

function section(heading: string, body: string | null | undefined): string {
  const text = (body ?? "").trim();
  if (!text) return "";
  return `## ${heading}\n\n${text}\n`;
}

function listSection(heading: string, items: string[]): string {
  if (items.length === 0) return "";
  return `## ${heading}\n\n${items.map((i) => `- ${i}`).join("\n")}\n`;
}

/** The shared context block every prompt opens with. Absent sections are omitted. */
export function buildBriefBlock(brief: EventBrief): string {
  const sponsors = brief.technicalSponsors.map((s) =>
    [s.name, s.offering, s.status ? `(${s.status})` : ""]
      .filter(Boolean)
      .join(" — "),
  );
  const criteria = brief.evaluativeCriteria.map((c) =>
    [c.label, c.description].filter(Boolean).join(" — "),
  );

  return [
    `# Brief: ${brief.eventTitle}`,
    "",
    `Sponsoring organization: ${brief.organizationName}`,
    brief.confirmedWeekend ? `Event weekend: ${brief.confirmedWeekend}` : "",
    "",
    section("The problem they described", brief.painPoints),
    section("What a good outcome looks like to them", brief.goalsNeeds),
    section("Supporting context they provided", brief.supportingContext),
    section("Their technical stack", brief.technicalStack),
    listSection("Key technologies", brief.technicalTags),
    listSection("Files they attached", brief.attachmentNames),
    listSection("Technical sponsors and what they're providing", sponsors),
    listSection("How they'll judge the work", criteria),
  ]
    .filter((part) => part !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DocumentPrompt {
  system: string;
  prompt: string;
}

export function buildResearchPrompt(brief: EventBrief): DocumentPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing RESEARCH NOTES for the builders — the document they read first, before touching code. Cover: what this organization actually does, who is affected by the problem, how work like this is usually done elsewhere, what data or systems are likely involved, and the traps a weekend team should expect. End with the open questions someone should ask the sponsor on Friday night.

Markdown. No preamble, no closing pleasantries.`,
    prompt: buildBriefBlock(brief),
  };
}

export function buildStakeholderPreferencesPrompt(brief: EventBrief): DocumentPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing STAKEHOLDER PREFERENCES — the "build toward this" document. Turn what the sponsor said about their stack and constraints into concrete guidance: what to build with, what to avoid, how it has to be handed over so their team can actually run it after the weekend. Be explicit about what is a hard constraint versus a preference, and say which is which based on the brief. If the brief is silent on something important, list it as a question rather than deciding for them.

Markdown. No preamble.`,
    prompt: buildBriefBlock(brief),
  };
}

export function buildExamplePrdPrompt(brief: EventBrief): DocumentPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing an EXAMPLE PRD — one plausible, weekend-sized project a team could take on, written the way a good PRD reads: the problem, who it's for, what it does, what it explicitly does not do, and how you'd know it worked. It is an example to spark ideas, not an assignment: say so in one line at the top. Scope it to what a small team can genuinely finish between Friday evening and Sunday afternoon.

Markdown. No preamble.`,
    prompt: buildBriefBlock(brief),
  };
}

export function buildSetupInstructionsPrompt(brief: EventBrief): DocumentPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing SETUP INSTRUCTIONS for the starter repository — what a builder runs in the first fifteen minutes. Cover prerequisites, how to get the project running locally, where the supplied context lives, and how to get any credentials that are needed.

CREDENTIALS: describe how to request each one and the environment variable it belongs in (for example \`ACME_API_KEY=your-key-here\` in \`.env\`). Never write an actual key, token, or password. Say plainly that \`.env\` is not committed.

Markdown. No preamble.`,
    prompt: buildBriefBlock(brief),
  };
}

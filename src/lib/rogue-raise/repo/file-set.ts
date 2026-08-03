/**
 * Assembles the context-repo file tree (PRD §5.3.1 step 2).
 *
 * Pure: approved documents + the intake in, `path → content` out. That makes the
 * whole required tree assertable in unit tests with no network and no database,
 * which matters because this is the artifact participants actually read.
 *
 * The PRD's required paths:
 *   README.md · research/ · stakeholder-preferences.md · context/ ·
 *   prds/ (≥2 examples) · setup-agent-instructions.md · tools/
 */
import { slugify } from "../sponsors/slug";
import type { RepoFiles } from "../integrations/github";

export interface RepoAssetInput {
  type: string;
  title: string | null;
  body: string | null;
  version: number;
}

export interface RepoBuildInput {
  organizationName: string;
  eventTitle: string;
  eventSlug: string;
  /** Human-readable weekend and its expanded schedule lines, when confirmed. */
  weekendLabel: string | null;
  scheduleLines: string[];
  locationName: string | null;
  locationAddress: string | null;
  painPoints: string;
  goalsNeeds: string;
  supportingContext: string;
  attachmentNames: string[];
  technicalStack: string;
  technicalTags: string[];
  technicalSponsors: { name: string; offering: string | null; status: string | null }[];
  evaluativeCriteria: { label: string; description: string | null; weight: string | null }[];
  /** The approved documents, latest version of each type. */
  assets: RepoAssetInput[];
}

function assetBody(input: RepoBuildInput, type: string): string | null {
  const asset = input.assets.find((a) => a.type === type);
  const body = asset?.body?.trim();
  return body ? body : null;
}

/**
 * Marker a heading must carry to be treated as the start of a PRD.
 *
 * Splitting on *any* `##` was wrong: a document whose headings are ordinary
 * section headings — which is most documents — got shredded into files named
 * after them. The agent is told to write `## PRD: <name>`, so the split keys on
 * that and anything else stays one document. A structure the agent didn't
 * actually write is worse than a single file.
 */
const PRD_HEADING = /^##\s+PRD\s*[:\u2014-]\s*(.+?)\s*$/i;

/**
 * Split the example-PRD document into one file per PRD. Several PRDs in one
 * asset (rather than several assets) keeps genuinely different examples from
 * looking like revisions of each other under per-type versioning — but
 * participants should still see them as separate files.
 */
export function splitExamplePrds(document: string): { name: string; content: string }[] {
  const lines = document.split(/\r?\n/);
  const sections: { heading: string; lines: string[] }[] = [];
  const preamble: string[] = [];

  for (const line of lines) {
    const heading = PRD_HEADING.exec(line);
    if (heading) {
      sections.push({ heading: heading[1], lines: [line] });
      continue;
    }
    if (sections.length === 0) preamble.push(line);
    else sections[sections.length - 1].lines.push(line);
  }

  // Nothing marked as a PRD — keep the document whole rather than inventing a
  // structure the agent didn't write.
  if (sections.length === 0) {
    return [{ name: "01-example-prd.md", content: document.trim() }];
  }

  const intro = preamble.join("\n").trim();
  return sections.map((section, index) => {
    const number = String(index + 1).padStart(2, "0");
    const slug = slugify(section.heading) || `example-${number}`;
    const content = [
      index === 0 && intro ? `${intro}\n` : "",
      section.lines.join("\n").trim(),
      "",
    ]
      .filter(Boolean)
      .join("\n");
    return { name: `${number}-${slug}.md`, content: `${content}\n` };
  });
}

function bulletList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "_None provided._";
}

function buildReadme(input: RepoBuildInput): string {
  const schedule = input.scheduleLines.length
    ? input.scheduleLines.map((l) => `- ${l}`).join("\n")
    : "- Dates are being confirmed.";
  const location = [input.locationName, input.locationAddress]
    .filter(Boolean)
    .join(", ");

  return `# ${input.eventTitle}

A **Rogue Raise** — a weekend community build event run by [White Rabbit](https://whiterabbitashland.com) in Ashland, Oregon, modelled on a barn raising. Volunteers arrive Friday evening and ship something real by Sunday afternoon.

Sponsored by **${input.organizationName}**.

## The problem we're building around

${input.painPoints.trim() || "_To be described._"}

## What a good outcome looks like

${input.goalsNeeds.trim() || "_To be described._"}

## When and where

${schedule}
${location ? `\nLocation: ${location}` : ""}

## What's in this repository

| Path | What it is |
|------|------------|
| \`research/\` | Background on the problem domain — read this first. |
| \`stakeholder-preferences.md\` | What to build *toward*: the sponsor's stack and constraints. |
| \`context/\` | The material the sponsor gave us, arranged for you. |
| \`prds/\` | Example projects, of varying ambition. Pick one or invent your own. |
| \`setup-agent-instructions.md\` | Getting your own project repo running. |
| \`tools/\` | Technical sponsors and how to get access to what they're providing. |

## How the work is judged

${bulletList(
  input.evaluativeCriteria.map((c) =>
    [
      `**${c.label}**`,
      c.description ? `— ${c.description}` : "",
      c.weight ? `(weight ${c.weight})` : "",
    ]
      .filter(Boolean)
      .join(" "),
  ),
)}

---

_Nothing in this repository is a secret. If you need a credential, \`tools/\` explains how to ask for it._
`;
}

function buildContextFile(input: RepoBuildInput): string {
  return `# Context from ${input.organizationName}

## What they told us

${input.supportingContext.trim() || "_No written context was provided._"}

## Files they supplied

${bulletList(input.attachmentNames)}

> These files are held privately by White Rabbit. Ask a WR organizer at kickoff
> if you need one — they are not committed to this repository.
`;
}

function buildToolsFile(input: RepoBuildInput): string {
  const sponsors = input.technicalSponsors.length
    ? input.technicalSponsors
        .map((s) =>
          [
            `### ${s.name}`,
            "",
            s.offering ? s.offering : "_Offering to be confirmed._",
            "",
            s.status ? `Status: ${s.status}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n")
    : "_No technical sponsors for this event yet._";

  return `# Technical sponsors and tooling

${sponsors}

## Getting credentials

**No API key, token, or password appears anywhere in this repository, and none
should ever be committed to it.**

When you need access to something above:

1. Ask a White Rabbit organizer at the event — they will get you a key.
2. Put it in a local \`.env\` file, e.g. \`ACME_API_KEY=your-key-here\`.
3. Make sure \`.env\` is listed in your \`.gitignore\` before your first commit.

If you find a credential committed anywhere, tell an organizer immediately
rather than just deleting it — it has to be rotated.
`;
}

/** The asset types this tree needs, in the order a builder reads them. */
export const REQUIRED_ASSET_TYPES = [
  "research_doc",
  "stakeholder_preferences",
  "example_prd",
  "setup_agent_instructions",
] as const;

export function buildRepoFiles(input: RepoBuildInput): RepoFiles {
  const files: RepoFiles = {};

  files["README.md"] = buildReadme(input);

  const research = assetBody(input, "research_doc");
  files["research/README.md"] =
    research ??
    "# Research\n\n_Research notes have not been drafted yet._\n";

  const preferences = assetBody(input, "stakeholder_preferences");
  files["stakeholder-preferences.md"] = preferences
    ? `${preferences}\n`
    : `# Stakeholder preferences\n\n## Their stack\n\n${
        input.technicalStack.trim() || "_Not described._"
      }\n\n## Key technologies\n\n${bulletList(input.technicalTags)}\n`;

  files["context/README.md"] = buildContextFile(input);

  const prds = assetBody(input, "example_prd");
  if (prds) {
    for (const prd of splitExamplePrds(prds)) {
      files[`prds/${prd.name}`] = prd.content;
    }
  } else {
    files["prds/01-example-prd.md"] = "# Example PRD\n\n_Not drafted yet._\n";
  }

  const setup = assetBody(input, "setup_agent_instructions");
  files["setup-agent-instructions.md"] =
    setup ?? "# Setup\n\n_Setup instructions have not been drafted yet._\n";

  files["tools/README.md"] = buildToolsFile(input);

  // A repo participants will fork should make the secrets rule impossible to miss.
  files[".gitignore"] = ".env\n.env.local\n.env.*.local\nnode_modules/\n";

  return files;
}

/** Repo name for an event — the event slug already carries a random suffix. */
export function repoNameForEvent(eventSlug: string): string {
  return `rogue-raise-${slugify(eventSlug)}`.slice(0, 90);
}

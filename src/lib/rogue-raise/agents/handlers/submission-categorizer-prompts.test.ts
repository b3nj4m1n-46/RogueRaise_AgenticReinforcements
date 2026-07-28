import { describe, expect, it } from "vitest";

import {
  buildCategorizerPrompt,
  parseCategorization,
} from "./submission-categorizer-prompts";

const brief = {
  eventTitle: "Rogue Raise: The Unhoused",
  organizationName: "Jackson County Health Department",
  painPoints: "Shelter capacity data lives in spreadsheets.",
  goalsNeeds: "One view of beds tonight.",
  submissions: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      teamName: "Beds Tonight",
      projectSummary: "A phone-first view of shelter bed availability.",
      repoUrl: "https://github.com/wr/beds",
      languages: { TypeScript: 8000, CSS: 2000 },
      linesOfCode: 4200,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      teamName: "Warm Handoff",
      projectSummary: "A referral tracker with case notes.",
      repoUrl: "https://github.com/wr/handoff",
      languages: null,
      linesOfCode: null,
    },
  ],
};

describe("buildCategorizerPrompt", () => {
  it("gives the model the ids it must echo back", () => {
    const { prompt } = buildCategorizerPrompt(brief);
    for (const submission of brief.submissions) {
      expect(prompt).toContain(submission.id);
    }
  });

  it("turns language bytes into percentages a model can reason about", () => {
    const { prompt } = buildCategorizerPrompt(brief);
    expect(prompt).toContain("TypeScript 80%");
    expect(prompt).toContain("CSS 20%");
  });

  it("says 'not counted' rather than 0 when GitHub wouldn't answer", () => {
    const { prompt } = buildCategorizerPrompt(brief);
    expect(prompt).toContain("Lines of code: not counted");
    expect(prompt).not.toContain("Lines of code: 0");
  });

  it("tells the model it cannot read the code", () => {
    const { system } = buildCategorizerPrompt(brief);
    expect(system).toContain("You cannot read the code");
  });
});

describe("parseCategorization", () => {
  const reply = [
    "## OVERVIEW",
    "Four teams built for the shelter network. Three built dashboards; nobody",
    "touched the intake bottleneck that started this.",
    "",
    "## SUBMISSION: 11111111-1111-1111-1111-111111111111",
    "CATEGORY: Data dashboard",
    "Shows which beds are free tonight, for front-desk staff.",
    "",
    "## SUBMISSION: 22222222-2222-2222-2222-222222222222",
    "CATEGORY: Referral tracker",
    "Carries case notes between services so nobody restarts.",
  ].join("\n");

  it("pulls out the overview and every block", () => {
    const parsed = parseCategorization(reply);
    expect(parsed.overview).toContain("nobody");
    expect(parsed.perSubmission).toHaveLength(2);
    expect(parsed.perSubmission[0]).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      category: "Data dashboard",
    });
    expect(parsed.perSubmission[1].summary).toContain("case notes");
  });

  it("drops a block with no CATEGORY rather than inventing one", () => {
    const parsed = parseCategorization(
      [
        "## SUBMISSION: aaa",
        "Some prose but no category line.",
        "",
        "## SUBMISSION: bbb",
        "CATEGORY: Intake form",
        "Fine.",
      ].join("\n"),
    );
    expect(parsed.perSubmission.map((p) => p.id)).toEqual(["bbb"]);
  });

  it("ignores preamble before the first heading", () => {
    const parsed = parseCategorization(
      ["Sure! Here's the categorization:", "", reply].join("\n"),
    );
    expect(parsed.overview.startsWith("Sure")).toBe(false);
    expect(parsed.perSubmission).toHaveLength(2);
  });

  it("returns empty rather than throwing on an unmarked reply", () => {
    // Degrading to nothing is what lets the run still write its line counts.
    const parsed = parseCategorization("I categorized them all as software.");
    expect(parsed.perSubmission).toEqual([]);
    expect(parsed.overview).toBe("");
  });

  it("keeps a multi-line summary intact", () => {
    const parsed = parseCategorization(
      [
        "## SUBMISSION: xyz",
        "CATEGORY: Reporting tool",
        "First line of the summary.",
        "Second line of the summary.",
      ].join("\n"),
    );
    expect(parsed.perSubmission[0].summary).toBe(
      "First line of the summary.\nSecond line of the summary.",
    );
  });
});

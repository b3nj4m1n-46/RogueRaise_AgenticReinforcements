import { describe, expect, it } from "vitest";

import { findSecrets } from "../secrets";
import {
  buildBriefBlock,
  buildExamplePrdPrompt,
  buildResearchPrompt,
  buildSetupInstructionsPrompt,
  buildStakeholderPreferencesPrompt,
  type EventBrief,
} from "./context-research-prompts";

function brief(overrides: Partial<EventBrief> = {}): EventBrief {
  return {
    organizationName: "Jackson County Health Department",
    eventTitle: "Rogue Raise: The Unhoused",
    painPoints: "Shelter capacity data lives in spreadsheets.",
    goalsNeeds: "One place to see who has beds tonight.",
    supportingContext: "Five years of nightly bed-count emails.",
    technicalStack: "Postgres 14 and a Django admin.",
    technicalTags: ["postgres", "django"],
    attachmentNames: ["bed-counts.pdf"],
    technicalSponsors: [
      { name: "Acme AI", offering: "API credits for the weekend", status: "confirmed" },
    ],
    evaluativeCriteria: [{ label: "Impact", description: "Who it actually helps" }],
    confirmedWeekend: "Aug 14–16, 2026",
    ...overrides,
  };
}

describe("buildBriefBlock", () => {
  it("carries the sponsor's own words into the prompt", () => {
    const block = buildBriefBlock(brief());
    expect(block).toContain("Shelter capacity data lives in spreadsheets.");
    expect(block).toContain("One place to see who has beds tonight.");
    expect(block).toContain("Five years of nightly bed-count emails.");
    expect(block).toContain("Postgres 14 and a Django admin.");
    expect(block).toContain("Jackson County Health Department");
    expect(block).toContain("Aug 14–16, 2026");
  });

  it("includes technologies, attachments, sponsors, and criteria as lists", () => {
    const block = buildBriefBlock(brief());
    expect(block).toContain("- postgres");
    expect(block).toContain("- bed-counts.pdf");
    expect(block).toContain("Acme AI — API credits for the weekend — (confirmed)");
    expect(block).toContain("Impact — Who it actually helps");
  });

  it("omits sections the sponsor left empty rather than emitting empty headings", () => {
    const sparse = buildBriefBlock(
      brief({
        supportingContext: "",
        technicalTags: [],
        attachmentNames: [],
        technicalSponsors: [],
        evaluativeCriteria: [],
        confirmedWeekend: null,
      }),
    );
    expect(sparse).not.toContain("Supporting context");
    expect(sparse).not.toContain("Key technologies");
    expect(sparse).not.toContain("Files they attached");
    expect(sparse).not.toContain("Technical sponsors");
    expect(sparse).not.toContain("Event weekend");
    // …but still carries what IS there.
    expect(sparse).toContain("Shelter capacity data lives in spreadsheets.");
  });

  it("never leaves a run of blank lines from an omitted section", () => {
    const sparse = buildBriefBlock(brief({ supportingContext: "", technicalStack: "" }));
    expect(sparse).not.toMatch(/\n{3,}/);
  });
});

describe("document prompts", () => {
  const builders = [
    ["research notes", buildResearchPrompt],
    ["stakeholder preferences", buildStakeholderPreferencesPrompt],
    ["example PRD", buildExamplePrdPrompt],
    ["setup instructions", buildSetupInstructionsPrompt],
  ] as const;

  it.each(builders)("%s carries the brief and its own instructions", (_name, build) => {
    const { system, prompt } = build(brief());
    expect(prompt).toContain("Shelter capacity data lives in spreadsheets.");
    expect(system).toContain("Rogue Raise");
    expect(system.length).toBeGreaterThan(200);
  });

  it.each(builders)("%s forbids emitting credentials", (_name, build) => {
    expect(build(brief()).system).toMatch(/never (include|write) an? ?actual|Never include API keys/i);
  });

  it("tells the setup document how to describe credentials instead of printing them", () => {
    const { system } = buildSetupInstructionsPrompt(brief());
    expect(system).toContain("environment variable");
    expect(system).toContain("Never write an actual key");
    expect(system).toContain("not committed");
  });

  it("asks each document for something different", () => {
    const systems = builders.map(([, build]) => build(brief()).system);
    expect(new Set(systems).size).toBe(builders.length);
  });

  it("produces prompts that are themselves free of credential material", () => {
    // A sponsor could paste a key into a free-text intake field. The prompt is
    // built from those fields, so it gets the same scrutiny as the output.
    for (const [, build] of builders) {
      const { system, prompt } = build(brief());
      expect(findSecrets(`${system}\n${prompt}`)).toEqual([]);
    }
  });
});

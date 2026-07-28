import { describe, expect, it } from "vitest";

import { findSecrets } from "../agents/secrets";
import {
  buildRepoFiles,
  repoNameForEvent,
  splitExamplePrds,
  type RepoBuildInput,
} from "./file-set";

function input(overrides: Partial<RepoBuildInput> = {}): RepoBuildInput {
  return {
    organizationName: "Jackson County Health Department",
    eventTitle: "Rogue Raise: The Unhoused",
    eventSlug: "rogue-raise-unhoused-ab12cd",
    weekendLabel: "Aug 14–16, 2026",
    scheduleLines: [
      "Fri, Aug 14 — Kickoff at 5:00 PM",
      "Sun, Aug 16 — Results and winners at 6:00 PM",
    ],
    locationName: "5 North Main Street",
    locationAddress: "Ashland, Oregon",
    painPoints: "Shelter capacity data lives in spreadsheets.",
    goalsNeeds: "One place to see who has beds tonight.",
    supportingContext: "Five years of nightly bed-count emails.",
    attachmentNames: ["bed-counts.pdf"],
    technicalStack: "Postgres 14 and a Django admin.",
    technicalTags: ["postgres", "django"],
    technicalSponsors: [
      { name: "Acme AI", offering: "API credits for the weekend", status: "confirmed" },
    ],
    evaluativeCriteria: [
      { label: "Impact", description: "Who it actually helps", weight: "40" },
    ],
    assets: [
      { type: "research_doc", title: "Research", body: "# Research\n\nFindings.", version: 1 },
      {
        type: "stakeholder_preferences",
        title: "Preferences",
        body: "# Preferences\n\nStay in Postgres.",
        version: 1,
      },
      {
        type: "example_prd",
        title: "Example PRDs",
        body: "Pick one or invent your own.\n\n## PRD: Bed Board\n\nA nightly view.\n\n## PRD: Intake Triage\n\nSomething harder.",
        version: 1,
      },
      {
        type: "setup_agent_instructions",
        title: "Setup",
        body: "# Setup\n\nCopy .env.example to .env.",
        version: 1,
      },
    ],
    ...overrides,
  };
}

describe("buildRepoFiles — the PRD §5.3.1 tree", () => {
  it("produces every required path", () => {
    const files = buildRepoFiles(input());
    const paths = Object.keys(files);

    expect(paths).toContain("README.md");
    expect(paths).toContain("stakeholder-preferences.md");
    expect(paths).toContain("setup-agent-instructions.md");
    expect(paths.some((p) => p.startsWith("research/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("context/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("tools/"))).toBe(true);
    expect(paths.filter((p) => p.startsWith("prds/")).length).toBeGreaterThanOrEqual(2);
  });

  it("carries the approved documents' own text", () => {
    const files = buildRepoFiles(input());
    expect(files["research/README.md"]).toContain("Findings.");
    expect(files["stakeholder-preferences.md"]).toContain("Stay in Postgres.");
    expect(files["setup-agent-instructions.md"]).toContain("Copy .env.example");
  });

  it("puts the problem, the schedule, and the criteria in the README", () => {
    const readme = buildRepoFiles(input())["README.md"];
    expect(readme).toContain("Shelter capacity data lives in spreadsheets.");
    expect(readme).toContain("One place to see who has beds tonight.");
    expect(readme).toContain("Kickoff at 5:00 PM");
    expect(readme).toContain("5 North Main Street, Ashland, Oregon");
    expect(readme).toContain("Impact");
    expect(readme).toContain("Jackson County Health Department");
  });

  it("ships a .gitignore that keeps .env out of a forked repo", () => {
    expect(buildRepoFiles(input())[".gitignore"]).toContain(".env");
  });

  it("tells builders how to get credentials without printing any", () => {
    const tools = buildRepoFiles(input())["tools/README.md"];
    expect(tools).toContain("Acme AI");
    expect(tools).toContain("API credits for the weekend");
    expect(tools).toMatch(/No API key, token, or password appears anywhere/);
    expect(tools).toContain(".gitignore");
  });

  it("names the supplied files without committing them", () => {
    const context = buildRepoFiles(input())["context/README.md"];
    expect(context).toContain("bed-counts.pdf");
    expect(context).toMatch(/not committed to this repository/);
  });

  it("falls back to the intake when a document is missing, without leaving a hole", () => {
    const files = buildRepoFiles(input({ assets: [] }));
    // Still a complete tree…
    expect(Object.keys(files)).toContain("stakeholder-preferences.md");
    // …and the fallback uses what the sponsor actually said.
    expect(files["stakeholder-preferences.md"]).toContain("Postgres 14");
    expect(files["research/README.md"]).toContain("not been drafted");
  });

  it("says dates are being confirmed rather than inventing them", () => {
    const readme = buildRepoFiles(input({ scheduleLines: [] }))["README.md"];
    expect(readme).toContain("being confirmed");
  });

  it("emits no file containing credential material", () => {
    const files = buildRepoFiles(input());
    for (const [path, content] of Object.entries(files)) {
      expect({ path, findings: findSecrets(content) }).toEqual({ path, findings: [] });
    }
  });
});

describe("splitExamplePrds", () => {
  it("splits on the PRD marker into numbered, slugged files", () => {
    const parts = splitExamplePrds(
      "Intro line.\n\n## PRD: Bed Board\n\nEasy.\n\n## PRD: Intake Triage\n\nHarder.",
    );
    expect(parts.map((p) => p.name)).toEqual([
      "01-bed-board.md",
      "02-intake-triage.md",
    ]);
    expect(parts[0].content).toContain("Intro line.");
    expect(parts[0].content).toContain("Easy.");
    expect(parts[1].content).toContain("Harder.");
    // The intro belongs to the first file only.
    expect(parts[1].content).not.toContain("Intro line.");
  });

  it("keeps an unmarked document whole rather than inventing structure", () => {
    const parts = splitExamplePrds("Just one PRD, no headings.");
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("01-example-prd.md");
    expect(parts[0].content).toContain("Just one PRD");
  });

  it("does not shred a document whose headings are ordinary sections", () => {
    // The bug this replaced: any `##` was treated as a PRD boundary, so a
    // document with normal section headings became one file per section.
    const parts = splitExamplePrds(
      "# Notes\n\n## Instructions given\n\nx\n\n## Context supplied\n\ny",
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("01-example-prd.md");
  });

  it("survives a PRD heading that slugs to nothing", () => {
    const parts = splitExamplePrds("## PRD: ???\n\nBody.");
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toMatch(/^01-/);
  });
});

describe("repoNameForEvent", () => {
  it("is a valid, prefixed repo name", () => {
    expect(repoNameForEvent("rogue-raise-unhoused-ab12cd")).toBe(
      "rogue-raise-rogue-raise-unhoused-ab12cd",
    );
    expect(repoNameForEvent("Jackson County!! 2026")).toMatch(/^rogue-raise-[a-z0-9-]+$/);
  });

  it("stays within GitHub's name length", () => {
    expect(repoNameForEvent("x".repeat(200)).length).toBeLessThanOrEqual(90);
  });
});

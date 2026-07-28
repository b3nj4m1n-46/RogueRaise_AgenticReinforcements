import { describe, expect, it } from "vitest";

import {
  evaluateCompleteness,
  factsFromDraft,
  summarizeCompleteness,
} from "./completeness";
import { emptyIntakeDraft, type IntakeDraft } from "./schema";

const FRIDAY = "2026-08-14";

function draft(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return { ...emptyIntakeDraft(), ...overrides };
}

const withAllRequired = draft({
  dateOptions: [{ date: FRIDAY, kickoffHour: 17 }],
  supplementaryInfo: "Five years of shelter intake spreadsheets.",
  stakeholderTechStack: "Postgres, a Django admin, and a lot of Excel.",
});

describe("evaluateCompleteness", () => {
  it("blocks an empty draft and names all three vital fields", () => {
    const result = evaluateCompleteness(factsFromDraft(draft(), 0));
    expect(result.complete).toBe(false);
    expect(result.requiredMetCount).toBe(0);
    expect(result.requiredTotal).toBe(3);
    expect(result.required.map((r) => r.key)).toEqual([
      "potential_dates",
      "supplementary_info",
      "stakeholder_tech_stack",
    ]);
  });

  it("completes when all three vital fields are present", () => {
    const result = evaluateCompleteness(factsFromDraft(withAllRequired, 0));
    expect(result.complete).toBe(true);
    expect(result.requiredMetCount).toBe(3);
  });

  it("accepts an uploaded file in place of written supporting context", () => {
    const noText = draft({
      dateOptions: [{ date: FRIDAY, kickoffHour: 17 }],
      stakeholderTechStack: "Postgres",
    });
    expect(evaluateCompleteness(factsFromDraft(noText, 0)).complete).toBe(false);
    expect(evaluateCompleteness(factsFromDraft(noText, 1)).complete).toBe(true);
  });

  it("treats whitespace-only text as missing", () => {
    const blank = draft({ ...withAllRequired, stakeholderTechStack: "   " });
    expect(evaluateCompleteness(factsFromDraft(blank, 0)).complete).toBe(false);
  });

  it("never lets an optional section block completion", () => {
    const result = evaluateCompleteness(factsFromDraft(withAllRequired, 0));
    expect(result.complete).toBe(true);
    expect(result.optional.every((o) => !o.met)).toBe(true);
  });

  it("marks optional sections met once filled", () => {
    const rich = draft({
      ...withAllRequired,
      judges: [{ name: "Ada", email: "ada@example.org", phone: undefined }],
      criteria: [{ label: "Impact", description: undefined, weight: undefined }],
      awardsBudget: { amount: "1500", note: undefined },
      techSponsors: [
        {
          name: "Acme AI",
          offering: undefined,
          contactName: undefined,
          contactEmail: undefined,
          status: "proposed",
        },
      ],
    });
    expect(evaluateCompleteness(factsFromDraft(rich, 0)).optional.every((o) => o.met)).toBe(true);
  });

  it("counts an awards budget note alone as provided", () => {
    const noted = draft({ awardsBudget: { amount: undefined, note: "TBD after our board meets" } });
    const budget = evaluateCompleteness(factsFromDraft(noted, 0)).optional.find(
      (o) => o.key === "awards_budget",
    );
    expect(budget?.met).toBe(true);
  });
});

describe("facts read straight from the database", () => {
  // The server recomputes completion from committed rows, not from the draft —
  // this is that shape, and it must reach the same verdict.
  const dbFacts = {
    dateOptionCount: 2,
    supplementaryInfo: null,
    attachmentCount: 1,
    stakeholderTechStack: "Postgres + Django",
    judgeCount: 0,
    criteriaCount: 0,
    techSponsorCount: 0,
    awardsBudgetAmount: null,
    awardsBudgetNote: null,
  };

  it("completes on attachments alone", () => {
    expect(evaluateCompleteness(dbFacts).complete).toBe(true);
  });

  it("reverts to incomplete when the last attachment is removed", () => {
    expect(evaluateCompleteness({ ...dbFacts, attachmentCount: 0 }).complete).toBe(
      false,
    );
  });

  it("reverts to incomplete when the last weekend option is removed", () => {
    expect(evaluateCompleteness({ ...dbFacts, dateOptionCount: 0 }).complete).toBe(
      false,
    );
  });
});

describe("summarizeCompleteness", () => {
  it("lists what is still missing", () => {
    const summary = summarizeCompleteness(evaluateCompleteness(factsFromDraft(draft(), 0)));
    expect(summary).toContain("Possible weekends");
    expect(summary).toContain("Your technical stack");
  });

  it("says so plainly when nothing is missing", () => {
    expect(summarizeCompleteness(evaluateCompleteness(factsFromDraft(withAllRequired, 0)))).toMatch(
      /can move ahead/,
    );
  });
});

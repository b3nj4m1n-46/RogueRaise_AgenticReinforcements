import { describe, expect, it } from "vitest";

import {
  dropBlankRows,
  emptyIntakeDraft,
  intakeAwardsBudgetSchema,
  intakeCriterionSchema,
  intakeDateOptionSchema,
  intakeDraftSchema,
  intakeJudgeSchema,
  intakeTechSponsorSchema,
  isBlankRow,
  MAX_DATE_OPTIONS,
  MAX_TECH_TAGS,
  parseTags,
} from "./schema";

const FRIDAY = "2026-08-14";

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

describe("intakeJudgeSchema", () => {
  it("accepts a judge without a phone", () => {
    const parsed = intakeJudgeSchema.parse({
      name: "  Dr. Ada Lovelace ",
      email: "ada@example.org",
      phone: "",
    });
    expect(parsed).toEqual({
      name: "Dr. Ada Lovelace",
      email: "ada@example.org",
      phone: undefined,
    });
  });

  it("requires a real email — the column is NOT NULL", () => {
    const result = intakeJudgeSchema.safeParse({ name: "Ada", email: "nope" });
    expect(result.success).toBe(false);
    expect(firstError(result)).toMatch(/valid email/);
  });

  it("enforces E.164 when a phone is given", () => {
    const result = intakeJudgeSchema.safeParse({
      name: "Ada",
      email: "ada@example.org",
      phone: "541-555-1234",
    });
    expect(result.success).toBe(false);
    expect(firstError(result)).toMatch(/E\.164/);
  });
});

describe("intakeCriterionSchema", () => {
  it("keeps an exact decimal weight as a string", () => {
    const parsed = intakeCriterionSchema.parse({ label: "Impact", weight: "12.5" });
    expect(parsed.weight).toBe("12.5");
  });

  it("rejects a weight above 100", () => {
    const result = intakeCriterionSchema.safeParse({ label: "Impact", weight: "101" });
    expect(result.success).toBe(false);
    expect(firstError(result)).toMatch(/exceed 100/);
  });

  it("treats a blank description as absent", () => {
    expect(intakeCriterionSchema.parse({ label: "Impact", description: "   " }).description)
      .toBeUndefined();
  });
});

describe("intakeDateOptionSchema", () => {
  it("accepts a Friday with a kickoff hour", () => {
    expect(intakeDateOptionSchema.parse({ date: FRIDAY, kickoffHour: 17 }).date).toBe(
      FRIDAY,
    );
  });

  it("rejects a non-Friday with a human explanation", () => {
    const result = intakeDateOptionSchema.safeParse({
      date: "2026-08-15",
      kickoffHour: 17,
    });
    expect(result.success).toBe(false);
    expect(firstError(result)).toMatch(/start on a Friday/);
  });

  it("rejects a kickoff outside the afternoon/evening window", () => {
    expect(
      intakeDateOptionSchema.safeParse({ date: FRIDAY, kickoffHour: 9 }).success,
    ).toBe(false);
    expect(
      intakeDateOptionSchema.safeParse({ date: FRIDAY, kickoffHour: 21 }).success,
    ).toBe(false);
  });
});

describe("intakeTechSponsorSchema", () => {
  it("defaults status to proposed", () => {
    expect(intakeTechSponsorSchema.parse({ name: "Acme AI" }).status).toBe("proposed");
  });

  it("validates a contact email when present", () => {
    const result = intakeTechSponsorSchema.safeParse({
      name: "Acme AI",
      contactEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});

describe("intakeAwardsBudgetSchema", () => {
  it("accepts an empty budget", () => {
    expect(intakeAwardsBudgetSchema.parse({ amount: "", note: "" })).toEqual({
      amount: undefined,
      note: undefined,
    });
  });

  it("rejects a malformed amount", () => {
    expect(intakeAwardsBudgetSchema.safeParse({ amount: "1,500" }).success).toBe(false);
  });
});

describe("intakeDraftSchema", () => {
  it("accepts a completely empty draft — the intake starts blank", () => {
    expect(intakeDraftSchema.safeParse(emptyIntakeDraft()).success).toBe(true);
  });

  it("caps repeatable collections", () => {
    const tooMany = {
      ...emptyIntakeDraft(),
      dateOptions: Array.from({ length: MAX_DATE_OPTIONS + 1 }, () => ({
        date: FRIDAY,
        kickoffHour: 17,
      })),
    };
    const result = intakeDraftSchema.safeParse(tooMany);
    expect(result.success).toBe(false);
    expect(firstError(result)).toMatch(/Up to 6 weekend options/);
  });

  it("reports errors by dot-path so the form can highlight the row", () => {
    const result = intakeDraftSchema.safeParse({
      ...emptyIntakeDraft(),
      judges: [{ name: "Ada", email: "broken" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join(".")).toBe("judges.0.email");
  });
});

describe("blank rows", () => {
  it("recognizes an untouched row", () => {
    expect(isBlankRow({ name: "", email: "  ", phone: undefined })).toBe(true);
    expect(isBlankRow({ name: "Ada", email: "" })).toBe(false);
  });

  it("drops blank rows and keeps order", () => {
    const rows = [
      { label: "Impact" },
      { label: "  " },
      { label: "Craft" },
    ];
    expect(dropBlankRows(rows)).toEqual([{ label: "Impact" }, { label: "Craft" }]);
  });
});

describe("parseTags", () => {
  it("splits on commas and newlines, trims, and de-dupes case-insensitively", () => {
    expect(parseTags(" postgres, Postgres\nnext.js ,, python ")).toEqual([
      "postgres",
      "next.js",
      "python",
    ]);
  });

  it("stops at the tag cap", () => {
    const raw = Array.from({ length: MAX_TECH_TAGS + 5 }, (_, i) => `tag${i}`).join(",");
    expect(parseTags(raw)).toHaveLength(MAX_TECH_TAGS);
  });
});

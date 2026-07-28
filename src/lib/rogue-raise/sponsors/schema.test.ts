import { describe, expect, it } from "vitest";

import {
  E164_REGEX,
  financialCommitmentSchema,
  sponsorApplicationSchema,
  type SponsorApplicationInput,
} from "@/lib/rogue-raise/sponsors/schema";

/** A fully-valid application; individual tests override one slice at a time. */
function validPayload(
  overrides: Partial<SponsorApplicationInput> = {},
): SponsorApplicationInput {
  return {
    orgName: "Acme Robotics",
    pocName: "Jane Doe",
    pocEmail: "jane@acme.test",
    pocPhone: "+15415551234",
    painPoints: "Our onboarding is painfully manual and slow.",
    goalsNeeds: "We want an automated intake flow by Q3.",
    financialCommitment: { amount: "5000", note: "flexible", toDiscuss: false },
    stakeholders: [
      { name: "Sam Lee", email: "sam@acme.test", phone: "+15415550000" },
    ],
    ...overrides,
  };
}

/** All dot-path keys that failed, for convenient assertions. */
function errorPaths(result: ReturnType<typeof sponsorApplicationSchema.safeParse>) {
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.map(String).join("."));
}

describe("sponsorApplicationSchema", () => {
  it("accepts a fully-valid payload", () => {
    const result = sponsorApplicationSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  describe("pocPhone E.164", () => {
    it.each([
      ["missing +", "15415551234"],
      ["leading 0 after +", "+05415551234"],
      ["too short", "+12345"],
      ["too long", "+1234567890123456"],
      ["non-digits", "+1541555abcd"],
    ])("rejects %s (%s)", (_label, phone) => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ pocPhone: phone }),
      );
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain("pocPhone");
    });

    it("accepts a canonical E.164 number", () => {
      expect(E164_REGEX.test("+15415551234")).toBe(true);
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ pocPhone: "+447911123456" }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("required long-text fields", () => {
    it.each(["painPoints", "goalsNeeds"] as const)(
      "rejects empty %s",
      (field) => {
        const result = sponsorApplicationSchema.safeParse(
          validPayload({ [field]: "" } as Partial<SponsorApplicationInput>),
        );
        expect(result.success).toBe(false);
        expect(errorPaths(result)).toContain(field);
      },
    );

    it.each(["painPoints", "goalsNeeds"] as const)(
      "rejects whitespace-only %s",
      (field) => {
        const result = sponsorApplicationSchema.safeParse(
          validPayload({ [field]: "   \t  " } as Partial<SponsorApplicationInput>),
        );
        expect(result.success).toBe(false);
        expect(errorPaths(result)).toContain(field);
      },
    );

    it("rejects empty orgName and pocName", () => {
      expect(
        sponsorApplicationSchema.safeParse(validPayload({ orgName: "  " }))
          .success,
      ).toBe(false);
      expect(
        sponsorApplicationSchema.safeParse(validPayload({ pocName: "" }))
          .success,
      ).toBe(false);
    });
  });

  describe("stakeholders cardinality", () => {
    const stakeholder = (n: number) => ({
      name: `Person ${n}`,
      email: `p${n}@acme.test`,
      phone: "+15415550000",
    });

    it("rejects an empty stakeholder list (min 1)", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ stakeholders: [] }),
      );
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain("stakeholders");
    });

    it("accepts exactly 1 stakeholder", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ stakeholders: [stakeholder(1)] }),
      );
      expect(result.success).toBe(true);
    });

    it("accepts exactly 20 stakeholders", () => {
      const twenty = Array.from({ length: 20 }, (_, i) => stakeholder(i));
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ stakeholders: twenty }),
      );
      expect(result.success).toBe(true);
    });

    it("rejects 21 stakeholders (max 20)", () => {
      const twentyOne = Array.from({ length: 21 }, (_, i) => stakeholder(i));
      const result = sponsorApplicationSchema.safeParse(
        validPayload({ stakeholders: twentyOne }),
      );
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain("stakeholders");
    });

    it("rejects a stakeholder with a bad email or phone", () => {
      const bad = sponsorApplicationSchema.safeParse(
        validPayload({
          stakeholders: [
            { name: "X", email: "nope", phone: "+15415550000" },
            { name: "Y", email: "y@acme.test", phone: "5555" },
          ],
        }),
      );
      expect(bad.success).toBe(false);
      expect(errorPaths(bad)).toEqual(
        expect.arrayContaining(["stakeholders.0.email", "stakeholders.1.phone"]),
      );
    });
  });

  describe("financial commitment XOR", () => {
    it("rejects toDiscuss=true WITH an amount", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          financialCommitment: { amount: "5000", toDiscuss: true },
        }),
      );
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain("financialCommitment.amount");
    });

    it("rejects toDiscuss=false WITH a null amount", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          financialCommitment: { amount: null, toDiscuss: false },
        }),
      );
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain("financialCommitment.amount");
    });

    it("accepts commit-an-amount (toDiscuss=false, amount set)", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          financialCommitment: { amount: "12000.50", toDiscuss: false },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("accepts prefer-to-discuss (toDiscuss=true, amount null)", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          financialCommitment: { amount: null, toDiscuss: true },
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("financial amount numeric string (financialCommitmentSchema)", () => {
    it.each(["100.5", "100.50", "5000", "9999999999", "0"])(
      "accepts %s",
      (amount) => {
        expect(
          financialCommitmentSchema.safeParse({ amount, toDiscuss: false })
            .success,
        ).toBe(true);
      },
    );

    it.each(["100.505", "abc", "-5", "1e3", "10.", ".5", "10000000000000"])(
      "rejects %s",
      (amount) => {
        expect(
          financialCommitmentSchema.safeParse({ amount, toDiscuss: false })
            .success,
        ).toBe(false);
      },
    );
  });

  describe("length caps", () => {
    it("accepts orgName at 200 chars, rejects at 201", () => {
      expect(
        sponsorApplicationSchema.safeParse(
          validPayload({ orgName: "a".repeat(200) }),
        ).success,
      ).toBe(true);
      expect(
        sponsorApplicationSchema.safeParse(
          validPayload({ orgName: "a".repeat(201) }),
        ).success,
      ).toBe(false);
    });

    it("accepts painPoints at 5000 chars, rejects at 5001", () => {
      expect(
        sponsorApplicationSchema.safeParse(
          validPayload({ painPoints: "a".repeat(5000) }),
        ).success,
      ).toBe(true);
      expect(
        sponsorApplicationSchema.safeParse(
          validPayload({ painPoints: "a".repeat(5001) }),
        ).success,
      ).toBe(false);
    });

    it("accepts financial note at 2000 chars, rejects at 2001", () => {
      expect(
        financialCommitmentSchema.safeParse({
          amount: "5000",
          note: "a".repeat(2000),
          toDiscuss: false,
        }).success,
      ).toBe(true);
      expect(
        financialCommitmentSchema.safeParse({
          amount: "5000",
          note: "a".repeat(2001),
          toDiscuss: false,
        }).success,
      ).toBe(false);
    });
  });

  describe("trimming", () => {
    it("trims orgName, pocName, painPoints, goalsNeeds", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          orgName: "  Acme Robotics  ",
          pocName: "  Jane Doe  ",
          painPoints: "  the problem  ",
          goalsNeeds: "  the goals  ",
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orgName).toBe("Acme Robotics");
        expect(result.data.pocName).toBe("Jane Doe");
        expect(result.data.painPoints).toBe("the problem");
        expect(result.data.goalsNeeds).toBe("the goals");
      }
    });

    it("trims stakeholder name and phone", () => {
      const result = sponsorApplicationSchema.safeParse(
        validPayload({
          stakeholders: [
            { name: "  Sam Lee  ", email: "sam@acme.test", phone: "  +15415550000  " },
          ],
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stakeholders[0].name).toBe("Sam Lee");
        expect(result.data.stakeholders[0].phone).toBe("+15415550000");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Admin curation (story 2) — decision schema + pure transition guards.
// Appended describe blocks only; the 63 pre-existing cases above are untouched.
// ---------------------------------------------------------------------------

import {
  adminDecisionSchema,
  allowedNextStatus,
  isActionableAppStatus,
  type SponsorAppStatus,
} from "@/lib/rogue-raise/sponsors/schema";

describe("adminDecisionSchema", () => {
  it("accepts an omitted note (optional)", () => {
    const result = adminDecisionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeUndefined();
  });

  it("accepts an empty-string note (trims to empty, stays valid)", () => {
    const result = adminDecisionSchema.safeParse({ note: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("");
  });

  it("accepts a note at exactly 2000 chars", () => {
    expect(
      adminDecisionSchema.safeParse({ note: "a".repeat(2000) }).success,
    ).toBe(true);
  });

  it("rejects a note at 2001 chars", () => {
    expect(
      adminDecisionSchema.safeParse({ note: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace from the note", () => {
    const result = adminDecisionSchema.safeParse({ note: "  looks great  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("looks great");
  });
});

describe("isActionableAppStatus", () => {
  it.each(["submitted", "under_review"])("returns true for %s", (status) => {
    expect(isActionableAppStatus(status)).toBe(true);
  });

  it.each(["approved", "rejected"])("returns false for %s", (status) => {
    expect(isActionableAppStatus(status)).toBe(false);
  });

  it("returns false for an unknown status", () => {
    expect(isActionableAppStatus("draft")).toBe(false);
  });
});

describe("allowedNextStatus", () => {
  it.each(["submitted", "under_review"] as const)(
    "approve from %s → app approved, event intake_pending",
    (current) => {
      expect(allowedNextStatus(current, "approve")).toEqual({
        appStatus: "approved",
        eventStatus: "intake_pending",
      });
    },
  );

  it.each(["submitted", "under_review"] as const)(
    "reject from %s → app rejected, event rejected (terminal)",
    (current) => {
      expect(allowedNextStatus(current, "reject")).toEqual({
        appStatus: "rejected",
        eventStatus: "rejected",
      });
    },
  );

  it.each(["approved", "rejected"] as const)(
    "throws for a non-actionable current status (%s)",
    (current) => {
      expect(() =>
        allowedNextStatus(current as SponsorAppStatus, "approve"),
      ).toThrow();
    },
  );
});

import { describe, expect, it } from "vitest";

import {
  aggregate,
  computeFinalScore,
  describeMethod,
  findTies,
  isComplete,
  isValidScore,
  rankByCriterion,
  scoringMethod,
  type Criterion,
} from "./scoring";

const unweighted: Criterion[] = [
  { id: "a", label: "Impact", weight: null },
  { id: "b", label: "Craft", weight: null },
];

const weighted: Criterion[] = [
  { id: "a", label: "Impact", weight: "2.000" },
  { id: "b", label: "Craft", weight: "1.000" },
];

describe("isValidScore", () => {
  it("accepts whole numbers on the 1-5 scale", () => {
    expect([1, 2, 3, 4, 5].every(isValidScore)).toBe(true);
  });

  it("rejects out-of-range, fractional, and non-numeric values", () => {
    for (const value of [0, 6, -1, 3.5, "4", null, undefined, NaN]) {
      expect(isValidScore(value)).toBe(false);
    }
  });
});

describe("scoringMethod", () => {
  it("is average when no criterion carries a weight", () => {
    expect(scoringMethod(unweighted)).toBe("average");
  });

  it("is weighted as soon as one criterion carries a weight", () => {
    expect(
      scoringMethod([
        { id: "a", label: "Impact", weight: "2" },
        { id: "b", label: "Craft", weight: null },
      ]),
    ).toBe("weighted");
  });

  it("treats a zero or unparseable weight as no weight", () => {
    expect(
      scoringMethod([
        { id: "a", label: "Impact", weight: "0" },
        { id: "b", label: "Craft", weight: "not a number" },
      ]),
    ).toBe("average");
  });

  it("is none with no criteria at all", () => {
    expect(scoringMethod([])).toBe("none");
  });
});

describe("computeFinalScore", () => {
  it("averages an unweighted card", () => {
    expect(computeFinalScore(unweighted, { a: 4, b: 2 })).toBe(3);
  });

  it("returns a weighted MEAN, so the result stays on the 1-5 scale", () => {
    // (2*5 + 1*2) / 3 = 4 — not the sum, 12.
    expect(computeFinalScore(weighted, { a: 5, b: 2 })).toBe(4);
  });

  it("counts an unweighted criterion in a weighted set as weight 1", () => {
    const mixed: Criterion[] = [
      { id: "a", label: "Impact", weight: "3" },
      { id: "b", label: "Craft", weight: null },
    ];
    // (3*4 + 1*2) / 4 = 3.5
    expect(computeFinalScore(mixed, { a: 4, b: 2 })).toBe(3.5);
  });

  it("scores a partial card on what was actually scored", () => {
    expect(computeFinalScore(unweighted, { a: 4 })).toBe(4);
  });

  it("is null when nothing valid was scored", () => {
    expect(computeFinalScore(unweighted, {})).toBeNull();
    expect(computeFinalScore(unweighted, { a: 9 })).toBeNull();
  });

  it("rounds to the three decimals the column stores", () => {
    const three: Criterion[] = [
      { id: "a", label: "A", weight: null },
      { id: "b", label: "B", weight: null },
      { id: "c", label: "C", weight: null },
    ];
    expect(computeFinalScore(three, { a: 1, b: 2, c: 2 })).toBe(1.667);
  });
});

describe("isComplete", () => {
  it("needs every criterion scored", () => {
    expect(isComplete(unweighted, { a: 3 })).toBe(false);
    expect(isComplete(unweighted, { a: 3, b: 3 })).toBe(true);
  });

  it("is false with no criteria — there is nothing to be complete about", () => {
    expect(isComplete([], {})).toBe(false);
  });
});

describe("describeMethod", () => {
  it("names the weights so the number can be explained out loud", () => {
    expect(describeMethod(weighted)).toContain("Impact ×2.000");
    expect(describeMethod(weighted)).toContain("Weighted average");
  });

  it("says so plainly when it is a straight average", () => {
    expect(describeMethod(unweighted)).toContain("Straight average");
  });

  it("mentions the unweighted remainder in a mixed set", () => {
    expect(
      describeMethod([
        { id: "a", label: "Impact", weight: "2" },
        { id: "b", label: "Craft", weight: null },
      ]),
    ).toContain("others ×1");
  });
});

describe("aggregate", () => {
  const submissions = [
    {
      submissionId: "s1",
      teamName: "Team One",
      judgeScores: [
        { judgeId: "j1", judgeName: "A", finalScore: 4, scores: { a: 5, b: 3 } },
        { judgeId: "j2", judgeName: "B", finalScore: 3, scores: { a: 3, b: 3 } },
      ],
    },
    {
      submissionId: "s2",
      teamName: "Team Two",
      judgeScores: [
        { judgeId: "j1", judgeName: "A", finalScore: 5, scores: { a: 5, b: 5 } },
      ],
    },
    { submissionId: "s3", teamName: "Unscored", judgeScores: [] },
  ];

  it("sorts by average, highest first", () => {
    const rows = aggregate(unweighted, submissions);
    expect(rows.map((r) => r.teamName)).toEqual([
      "Team Two",
      "Team One",
      "Unscored",
    ]);
  });

  it("averages the judges' final scores", () => {
    const rows = aggregate(unweighted, submissions);
    expect(rows.find((r) => r.submissionId === "s1")?.average).toBe(3.5);
    expect(rows.find((r) => r.submissionId === "s1")?.judgeCount).toBe(2);
  });

  it("leaves an unscored project null rather than zero", () => {
    const row = aggregate(unweighted, submissions).find(
      (r) => r.submissionId === "s3",
    );
    // Zero would rank it as unanimously terrible instead of unjudged.
    expect(row?.average).toBeNull();
    expect(row?.judgeCount).toBe(0);
  });

  it("averages each criterion across judges for the breakdown", () => {
    const row = aggregate(unweighted, submissions).find(
      (r) => r.submissionId === "s1",
    );
    expect(row?.perCriterion.a).toBe(4);
    expect(row?.perCriterion.b).toBe(3);
  });
});

describe("findTies", () => {
  const rows = [
    { submissionId: "s1", teamName: "One", average: 4.5, judgeCount: 2, perCriterion: {} },
    { submissionId: "s2", teamName: "Two", average: 4.5, judgeCount: 2, perCriterion: {} },
    { submissionId: "s3", teamName: "Three", average: 3, judgeCount: 1, perCriterion: {} },
    { submissionId: "s4", teamName: "Four", average: null, judgeCount: 0, perCriterion: {} },
    { submissionId: "s5", teamName: "Five", average: null, judgeCount: 0, perCriterion: {} },
  ];

  it("reports a tie rather than breaking it", () => {
    const ties = findTies(rows);
    expect(ties).toHaveLength(1);
    expect(ties[0].map((r) => r.teamName).sort()).toEqual(["One", "Two"]);
  });

  it("does not treat two unscored projects as tied", () => {
    // Both are null, but "nobody has judged these" is not a tie to break.
    expect(findTies(rows).flat().map((r) => r.teamName)).not.toContain("Four");
  });

  it("returns nothing when every score is distinct", () => {
    expect(findTies(rows.slice(2, 3))).toEqual([]);
  });
});

describe("rankByCriterion", () => {
  const rows = [
    {
      submissionId: "s1",
      teamName: "One",
      average: 3,
      judgeCount: 1,
      perCriterion: { a: 2, b: 5 },
    },
    {
      submissionId: "s2",
      teamName: "Two",
      average: 4,
      judgeCount: 1,
      perCriterion: { a: 5, b: 2 },
    },
    {
      submissionId: "s3",
      teamName: "Three",
      average: null,
      judgeCount: 0,
      perCriterion: { a: null, b: null },
    },
  ];

  it("re-orders by the named criterion, not the overall average", () => {
    expect(rankByCriterion("b", rows).map((r) => r.teamName)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("drops projects with no score on that criterion", () => {
    expect(rankByCriterion("a", rows).map((r) => r.teamName)).not.toContain(
      "Three",
    );
  });
});

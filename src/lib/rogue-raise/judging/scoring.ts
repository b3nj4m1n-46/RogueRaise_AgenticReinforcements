/**
 * Score computation (PRD §7.2, §7.3). Pure, so the arithmetic that decides who
 * wins is testable in isolation — which matters more here than anywhere else in
 * the platform.
 *
 * Two rules the PRD sets and this module keeps:
 *   - **Weighted when weights are given, average otherwise — and the method is
 *     displayed.** A number nobody can explain is worse than a cruder one
 *     everybody can, so `describeMethod` exists and the UI shows it.
 *   - **Ties are surfaced, never silently broken.** Nothing here sorts a tie
 *     apart; `findTies` reports them for a person to decide.
 */

export interface Criterion {
  id: string;
  label: string;
  /** Numeric string from `numeric(6,3)`, or null when unweighted. */
  weight: string | null;
}

/** `criterionId → 1..5`. Missing entries mean "not scored". */
export type ScoreMap = Record<string, number>;

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

export function isValidScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SCORE &&
    value <= MAX_SCORE
  );
}

/** True when every criterion has a valid score. */
export function isComplete(criteria: Criterion[], scores: ScoreMap): boolean {
  return criteria.length > 0 && criteria.every((c) => isValidScore(scores[c.id]));
}

export type ScoringMethod = "weighted" | "average" | "none";

function toWeight(weight: string | null): number {
  if (weight === null) return 0;
  const value = Number(weight);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function scoringMethod(criteria: Criterion[]): ScoringMethod {
  if (criteria.length === 0) return "none";
  // Weighted as soon as ANY criterion carries a usable weight. A
  // partially-weighted set stays weighted, with unweighted criteria counting as
  // 1 — better than silently discarding weights somebody deliberately set.
  return criteria.some((c) => toWeight(c.weight) > 0) ? "weighted" : "average";
}

/**
 * One judge's score for one submission, on the 1–5 scale.
 *
 * Weighted mode returns a weighted MEAN (not a sum), so the result stays on the
 * 1–5 scale and is comparable with the unweighted case. 4.2 means the same
 * thing under both methods, which is what makes the displayed method honest
 * rather than decorative.
 */
export function computeFinalScore(
  criteria: Criterion[],
  scores: ScoreMap,
): number | null {
  const scored = criteria.filter((c) => isValidScore(scores[c.id]));
  if (scored.length === 0) return null;

  if (scoringMethod(criteria) === "weighted") {
    let weightSum = 0;
    let total = 0;
    for (const criterion of scored) {
      const weight = toWeight(criterion.weight) || 1;
      weightSum += weight;
      total += weight * scores[criterion.id];
    }
    return weightSum === 0 ? null : round(total / weightSum);
  }

  const total = scored.reduce((sum, c) => sum + scores[c.id], 0);
  return round(total / scored.length);
}

/** Three decimals — what `numeric(6,3)` stores. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function describeMethod(criteria: Criterion[]): string {
  switch (scoringMethod(criteria)) {
    case "weighted": {
      const weighted = criteria.filter((c) => toWeight(c.weight) > 0);
      const others = weighted.length < criteria.length ? ", others ×1" : "";
      return `Weighted average across ${criteria.length} criteria (${weighted
        .map((c) => `${c.label} ×${c.weight}`)
        .join(", ")}${others}), each scored 1–5.`;
    }
    case "average":
      return `Straight average across ${criteria.length} criteria, each scored 1–5.`;
    case "none":
      return "No judging criteria are set for this event yet.";
  }
}

// --- Aggregation across judges ---------------------------------------------

export interface SubmissionScores {
  submissionId: string;
  teamName: string;
  /** One entry per judge who submitted a final score. */
  judgeScores: {
    judgeId: string;
    judgeName: string;
    finalScore: number;
    scores: ScoreMap;
  }[];
}

export interface AggregateRow {
  submissionId: string;
  teamName: string;
  /** Mean of the judges' final scores; null when nobody has scored it. */
  average: number | null;
  judgeCount: number;
  /** Per-criterion mean across judges, for the breakdown. */
  perCriterion: Record<string, number | null>;
}

export function aggregate(
  criteria: Criterion[],
  submissions: SubmissionScores[],
): AggregateRow[] {
  return submissions
    .map((submission) => {
      const finals = submission.judgeScores.map((j) => j.finalScore);
      const perCriterion: Record<string, number | null> = {};
      for (const criterion of criteria) {
        const values = submission.judgeScores
          .map((j) => j.scores[criterion.id])
          .filter(isValidScore);
        perCriterion[criterion.id] = values.length
          ? round(values.reduce((a, b) => a + b, 0) / values.length)
          : null;
      }
      return {
        submissionId: submission.submissionId,
        teamName: submission.teamName,
        average: finals.length
          ? round(finals.reduce((a, b) => a + b, 0) / finals.length)
          : null,
        judgeCount: finals.length,
        perCriterion,
      };
    })
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
}

/**
 * Groups of submissions sharing a score. Reported, never resolved — PRD §7.3 is
 * explicit that a tie is an admin decision, and a platform that quietly ordered
 * them by id would be making that decision invisibly.
 */
export function findTies(rows: AggregateRow[]): AggregateRow[][] {
  const byScore = new Map<number, AggregateRow[]>();
  for (const row of rows) {
    if (row.average === null) continue;
    const group = byScore.get(row.average) ?? [];
    group.push(row);
    byScore.set(row.average, group);
  }
  return [...byScore.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => (b[0].average ?? 0) - (a[0].average ?? 0));
}

/** Ranking by a single criterion — how award categories get derived (§7.3). */
export function rankByCriterion(
  criterionId: string,
  rows: AggregateRow[],
): AggregateRow[] {
  return [...rows]
    .filter((row) => row.perCriterion[criterionId] !== null)
    .sort(
      (a, b) =>
        (b.perCriterion[criterionId] ?? 0) - (a.perCriterion[criterionId] ?? 0),
    );
}

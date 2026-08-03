/**
 * What still blocks the event from advancing (PRD §5.2.2).
 *
 * A pure function over plain FACTS, so the three callers agree by construction:
 *   - the client progress indicator (facts derived from the in-memory draft),
 *   - the server action's `Event.status → intake_complete` decision (facts read
 *     back from the committed rows),
 *   - anything later that wants to explain "why isn't this event moving?".
 *
 * VITAL (blocking): `potential_dates`, `supplementary_info`, `stakeholder_tech_stack`.
 * Everything else is genuinely optional at intake time, though judges and
 * criteria block their own downstream steps (judge emails, the scoring form) —
 * which is why they're reported as "needed later" rather than silently ignored.
 */
import type { IntakeDraft } from "./schema";

export interface CompletenessFacts {
  dateOptionCount: number;
  supplementaryInfo?: string | null;
  /** Files satisfy `supplementary_info` on their own — it is "Attachment[] + text". */
  attachmentCount: number;
  stakeholderTechStack?: string | null;
  judgeCount: number;
  criteriaCount: number;
  techSponsorCount: number;
  awardsBudgetAmount?: string | null;
  awardsBudgetNote?: string | null;
}

export interface IntakeRequirement {
  key: string;
  label: string;
  met: boolean;
  /** Shown when unmet — what the POC has to do, in their words. */
  hint: string;
}

export interface CompletenessResult {
  /** True when every VITAL requirement is met — the intake_complete gate. */
  complete: boolean;
  /** Blocking requirements, in form order. */
  required: IntakeRequirement[];
  /** Non-blocking, but each unblocks a later step. */
  optional: IntakeRequirement[];
  /** `met / total` over the required set — drives the progress bar. */
  requiredMetCount: number;
  requiredTotal: number;
}

function hasText(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Derive facts from an in-memory draft (client side, and the pre-save server check). */
export function factsFromDraft(
  draft: IntakeDraft,
  attachmentCount: number,
): CompletenessFacts {
  return {
    dateOptionCount: draft.dateOptions.length,
    supplementaryInfo: draft.supplementaryInfo,
    attachmentCount,
    stakeholderTechStack: draft.stakeholderTechStack,
    judgeCount: draft.judges.length,
    criteriaCount: draft.criteria.length,
    techSponsorCount: draft.techSponsors.length,
    awardsBudgetAmount: draft.awardsBudget.amount,
    awardsBudgetNote: draft.awardsBudget.note,
  };
}

export function evaluateCompleteness(facts: CompletenessFacts): CompletenessResult {
  const required: IntakeRequirement[] = [
    {
      key: "potential_dates",
      label: "Possible weekends",
      met: facts.dateOptionCount > 0,
      hint: "Offer at least one Friday–Sunday weekend that could work for you.",
    },
    {
      key: "supplementary_info",
      label: "Supporting context",
      met: hasText(facts.supplementaryInfo) || facts.attachmentCount > 0,
      hint: "Describe or upload the data, docs, or examples that explain the problem.",
    },
    {
      key: "stakeholder_tech_stack",
      label: "Your technical stack",
      met: hasText(facts.stakeholderTechStack),
      hint: "Tell us what you already run, so what gets built can live with you.",
    },
  ];

  const optional: IntakeRequirement[] = [
    {
      key: "judges",
      label: "Judges",
      met: facts.judgeCount > 0,
      hint: "Needed before we can send judge invitations.",
    },
    {
      key: "evaluative_criteria",
      label: "Evaluative criteria",
      met: facts.criteriaCount > 0,
      hint: "Needed before judges can score submissions.",
    },
    {
      key: "awards_budget",
      label: "Awards budget",
      met: Boolean(facts.awardsBudgetAmount) || hasText(facts.awardsBudgetNote),
      hint: "Helps us set expectations with participants about prizes.",
    },
    {
      key: "technical_sponsors",
      label: "Technical sponsors",
      met: facts.techSponsorCount > 0,
      hint: "Tools or credits a partner is providing, if any.",
    },
  ];

  const requiredMetCount = required.filter((r) => r.met).length;

  return {
    complete: requiredMetCount === required.length,
    required,
    optional,
    requiredMetCount,
    requiredTotal: required.length,
  };
}

/** One-line summary for live regions and the admin view. */
export function summarizeCompleteness(result: CompletenessResult): string {
  if (result.complete) {
    return "All vital details are in — your Rogue Raise can move ahead.";
  }
  const missing = result.required.filter((r) => !r.met).map((r) => r.label);
  return `Still needed: ${missing.join(", ")}.`;
}

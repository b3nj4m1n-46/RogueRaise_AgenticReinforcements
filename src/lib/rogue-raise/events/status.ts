/**
 * Event-phase gates for the admin console. Pure and DB-free so both the server
 * actions and the UI can ask the same questions and never disagree about what
 * is allowed right now.
 *
 * `Event.status` is the single source of truth for what is unlocked (PRD §4), so
 * every one of these is a list of statuses rather than an ad-hoc boolean.
 */

/**
 * When confirming a weekend is meaningful: from the moment an intake exists
 * until registration has opened. Before `intake_pending` there are no date
 * options to choose from; from `live` onward the weekend is already happening.
 */
export const CONFIRMABLE_STATUSES = [
  "intake_pending",
  "intake_complete",
  "repo_generating",
  "repo_review",
  "repo_approved",
  "registration_open",
] as const;

/**
 * Confirming here is allowed but consequential — participants have already been
 * shown dates, so the UI warns before the action rather than silently moving them.
 */
export const LATE_CONFIRM_STATUSES = ["registration_open"] as const;

/** When reissuing the sponsor's intake link still makes sense. */
export const REISSUABLE_STATUSES = ["intake_pending", "intake_complete"] as const;

export function canConfirmWeekend(status: string): boolean {
  return (CONFIRMABLE_STATUSES as readonly string[]).includes(status);
}

export function isLateConfirm(status: string): boolean {
  return (LATE_CONFIRM_STATUSES as readonly string[]).includes(status);
}

export function canReissueIntakeInvite(status: string): boolean {
  return (REISSUABLE_STATUSES as readonly string[]).includes(status);
}

/** Human label for an `event_status` value — used in the queue and detail views. */
export const EVENT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  intake_pending: "Intake pending",
  intake_complete: "Intake complete",
  repo_generating: "Repo generating",
  repo_review: "Repo review",
  repo_approved: "Repo approved",
  registration_open: "Registration open",
  live: "Live",
  judging: "Judging",
  completed: "Completed",
  archived: "Archived",
};

export function eventStatusLabel(status: string): string {
  return EVENT_STATUS_LABELS[status] ?? status;
}

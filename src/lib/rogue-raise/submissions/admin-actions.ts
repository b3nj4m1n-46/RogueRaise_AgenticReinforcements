"use server";

/**
 * Admin controls for the submission window (PRD §7.1).
 *
 * Thin wrappers: the work lives in plain modules so it isn't reachable as a POST
 * endpoint by itself, and these are what the console actually calls.
 */
import { revalidatePath } from "next/cache";

export async function sendSubmissionInvitesAction(
  eventId: string,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const { sendSubmissionInvites } = await import("./invite");
  const outcome = await sendSubmissionInvites(eventId);
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  const parts = [`${outcome.sent} sent`];
  // "Skipped" is not a failure — it is the idempotency guarantee doing its job,
  // and saying so out loud is what stops someone pressing the button again.
  if (outcome.skipped) parts.push(`${outcome.skipped} already had a live link`);
  if (outcome.failed) parts.push(`${outcome.failed} failed to send`);

  revalidatePath(`/admin/events/${eventId}/submissions`);
  return { ok: true, summary: `Submission links: ${parts.join(", ")}.` };
}

"use server";

/**
 * Admin control for stakeholder review. Thin wrapper: the work lives in a plain
 * module so it isn't reachable as a POST endpoint by itself.
 */
import { revalidatePath } from "next/cache";

import { adminActor, adminOrError } from "../admin/guard";

export async function sendReviewInvitesAction(
  eventId: string,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const { sendReviewInvites } = await import("./invite");
  const outcome = await sendReviewInvites(eventId, adminActor(guard.admin));
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  const parts = [`${outcome.sent} sent`];
  // "Skipped" means they were already asked about THIS round of drafts — not
  // that they replied. Saying so stops it reading as "they're done".
  if (outcome.skipped) parts.push(`${outcome.skipped} already asked this round`);
  if (outcome.failed) parts.push(`${outcome.failed} failed to send`);

  revalidatePath(`/admin/events/${eventId}/agents`);
  return { ok: true, summary: `Review invitations: ${parts.join(", ")}.` };
}

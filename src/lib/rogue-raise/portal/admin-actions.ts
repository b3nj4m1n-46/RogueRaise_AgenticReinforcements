"use server";

/**
 * Admin controls for the handoff portal. Thin wrappers: the work lives in plain
 * modules so it isn't reachable as a POST endpoint by itself.
 */
import { revalidatePath } from "next/cache";

export async function openPortalAction(
  eventId: string,
  options: { resend?: boolean } = {},
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const { openPortal } = await import("./invite");
  const outcome = await openPortal(eventId, options);
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  const parts = [`${outcome.sent} sent`];
  if (outcome.skipped) parts.push(`${outcome.skipped} already had access`);
  if (outcome.failed) parts.push(`${outcome.failed} failed to send`);

  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true, summary: `Handoff portal: ${parts.join(", ")}.` };
}

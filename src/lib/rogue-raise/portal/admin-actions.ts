"use server";

/**
 * Admin controls for the handoff portal. Thin wrappers: the work lives in plain
 * modules so it isn't reachable as a POST endpoint by itself.
 */
import { revalidatePath } from "next/cache";
import { adminActor, adminOrError } from "../admin/guard";

export async function openPortalAction(
  eventId: string,
  options: { resend?: boolean } = {},
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  // Authorization is enforced per action, not only by the layout: a Server
  // Action is reachable without ever rendering the page that hosts it.
  const guard = await adminOrError();
  if (!guard.ok) return { ok: false, error: guard.error };

  const { openPortal } = await import("./invite");
  const outcome = await openPortal(eventId, adminActor(guard.admin), options);
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  const parts = [`${outcome.sent} sent`];
  if (outcome.skipped) parts.push(`${outcome.skipped} already had access`);
  if (outcome.failed) parts.push(`${outcome.failed} failed to send`);

  revalidatePath(`/admin/events/${eventId}/results`);
  return { ok: true, summary: `Handoff portal: ${parts.join(", ")}.` };
}

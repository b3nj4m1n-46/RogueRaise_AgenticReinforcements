"use server";

/**
 * Privileged WR-Admin action: send the approved judge invitations.
 *
 * AUTH: `/admin/*` is env-gated dev-open (src/middleware.ts) — see HANDOFF.md.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminEventState } from "../events/state";
import { sendJudgeInvitations } from "./send";

export async function sendJudgeInvitationsAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const raw = formData.get("event_id");
  const eventId = typeof raw === "string" ? raw : "";
  const version = (prevState.version ?? 0) + 1;

  if (!z.uuid().safeParse(eventId).success) {
    return { ok: false, formError: "We couldn't find that event.", version };
  }

  const outcome = await sendJudgeInvitations(eventId);
  revalidatePath(`/admin/events/${eventId}/agents`);

  if (!outcome.ok) return { ok: false, formError: outcome.reason, version };

  const parts = [`Sent ${outcome.sent} invitation(s).`];
  if (outcome.skipped > 0) {
    parts.push(`${outcome.skipped} judge(s) already had a live link and were skipped.`);
  }
  if (outcome.unmatched.length > 0) {
    // Never silently drop a letter — an address the agent invented is a real
    // problem with the draft, and staff need to know before the event.
    parts.push(
      `${outcome.unmatched.length} letter(s) were addressed to people who aren't judges on this event and were NOT sent: ${outcome.unmatched.join(", ")}.`,
    );
  }
  return { ok: true, notice: parts.join(" "), version };
}

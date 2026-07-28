"use server";

/**
 * Privileged WR-Admin repo action. Provisioning itself lives in `provision.ts`;
 * this is the `useActionState` wrapper that the console form talks to.
 *
 * AUTH: `/admin/*` is env-gated dev-open (src/middleware.ts) — see HANDOFF.md.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminEventState } from "../events/state";
import { provisionContextRepo } from "./provision";

export async function provisionRepoAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const raw = formData.get("event_id");
  const eventId = typeof raw === "string" ? raw : "";
  const version = (prevState.version ?? 0) + 1;

  if (!z.uuid().safeParse(eventId).success) {
    return { ok: false, formError: "We couldn't find that event.", version };
  }

  const outcome = await provisionContextRepo(eventId);

  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/admin/events/${eventId}/agents`);

  if (!outcome.ok) {
    return { ok: false, formError: outcome.reason, version };
  }
  return {
    ok: true,
    notice: outcome.updated
      ? `Updated the context repo with ${outcome.fileCount} files. The pull request is open for review.`
      : `Built the context repo with ${outcome.fileCount} files. It's private until the review is approved.`,
    version,
  };
}

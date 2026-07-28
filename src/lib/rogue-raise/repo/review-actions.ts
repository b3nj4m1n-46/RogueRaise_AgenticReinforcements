"use server";

/**
 * Privileged WR-Admin repo-review actions (PRD §5.3.2): comment on a file,
 * approve the repo (which publishes it), or send it back to the agent.
 *
 * AUTH: `/admin/*` is env-gated dev-open (src/middleware.ts) — see HANDOFF.md.
 * The PRD also calls for a stakeholder-facing review view; there is no
 * stakeholder identity yet, so every comment here is recorded as `wr_admin`
 * rather than pretending otherwise.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminEventState } from "../events/state";
import { addComment, approveRepo, requestRepoChanges } from "./review";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function bump(prev: AdminEventState): number {
  return (prev.version ?? 0) + 1;
}

const bodySchema = z.string().trim().min(1, "Write something first").max(4000);

export async function commentOnRepoFileAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const eventId = str(formData, "event_id");
  const filePath = str(formData, "file_path");
  const parsed = bodySchema.safeParse(str(formData, "body"));

  if (!z.uuid().safeParse(eventId).success) {
    return { ok: false, formError: "We couldn't find that event.", version: bump(prevState) };
  }
  if (!parsed.success) {
    return {
      ok: false,
      formError: parsed.error.issues[0]?.message ?? "Write something first",
      version: bump(prevState),
    };
  }

  await addComment({
    eventId,
    filePath: filePath || null,
    body: parsed.data,
  });

  revalidatePath(`/admin/events/${eventId}/repo-review`);
  return { ok: true, notice: "Comment added.", version: bump(prevState) };
}

export async function approveRepoAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const eventId = str(formData, "event_id");
  if (!z.uuid().safeParse(eventId).success) {
    return { ok: false, formError: "We couldn't find that event.", version: bump(prevState) };
  }

  const outcome = await approveRepo(eventId);
  revalidatePath(`/admin/events/${eventId}/repo-review`);
  revalidatePath(`/admin/events/${eventId}`);

  return outcome.ok
    ? { ok: true, notice: outcome.notice, version: bump(prevState) }
    : { ok: false, formError: outcome.reason, version: bump(prevState) };
}

export async function requestRepoChangesAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const eventId = str(formData, "event_id");
  const parsed = bodySchema.safeParse(str(formData, "body"));

  if (!z.uuid().safeParse(eventId).success) {
    return { ok: false, formError: "We couldn't find that event.", version: bump(prevState) };
  }
  if (!parsed.success) {
    return {
      ok: false,
      formError: "Say what needs to change — it becomes the agent's instructions.",
      version: bump(prevState),
    };
  }

  const outcome = await requestRepoChanges({ eventId, feedback: parsed.data });
  revalidatePath(`/admin/events/${eventId}/repo-review`);
  revalidatePath(`/admin/events/${eventId}/agents`);

  return outcome.ok
    ? { ok: true, notice: outcome.notice, version: bump(prevState) }
    : { ok: false, formError: outcome.reason, version: bump(prevState) };
}

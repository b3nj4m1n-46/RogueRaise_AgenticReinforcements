"use server";

/**
 * Privileged WR-Admin agent actions: run an agent, re-run it with extra
 * instructions, and the review gate itself (PRD §11.1 — human-in-the-loop is
 * mandatory, nothing auto-publishes).
 *
 * Review semantics, and why:
 *   - **Approve / Reject** set `review_status` and record a note.
 *   - **Request edits** is not a dead end: the note is stored AND becomes the
 *     pre-filled instruction for a re-run, so the loop closes.
 *   - **Edit and approve** writes a NEW VERSION with `agent_run_id = null`
 *     rather than overwriting the agent's text. Overwriting would destroy the
 *     only record of what the agent actually produced — which is exactly what a
 *     reviewer is accountable for having changed.
 *   - Only the LATEST version of an asset type is actionable, so an approval can
 *     never be attached to superseded text.
 *
 * AUTH: `/admin/*` is env-gated dev-open (src/middleware.ts); the audit actor is
 * still the `wr-admin` placeholder. See HANDOFF.md.
 */
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "../db";
import { auditLog, generatedAssets } from "../db/schema";
import { ACTOR_WR_ADMIN, type AdminEventState } from "../events/state";
import { getAgentDefinition, type AgentType } from "./catalog";
import { runAgent, rerunAgent } from "./execute";
import { registerAgentHandlers } from "./handlers";
import { findSecrets, describeSecretFindings } from "./secrets";

// Registering here means every entry point that can run an agent has the
// handlers loaded, without each route remembering to import them.
registerAgentHandlers();

const REVIEW_DECISIONS = ["approve", "request_edits", "reject"] as const;
type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** `review_status` value each decision writes. */
const DECISION_STATUS: Record<ReviewDecision, "approved" | "edit_requested" | "rejected"> =
  {
    approve: "approved",
    request_edits: "edit_requested",
    reject: "rejected",
  };

const noteSchema = z.string().trim().max(4000, "Note is too long").optional();

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function nextVersion(prev: AdminEventState): number {
  return (prev.version ?? 0) + 1;
}

function fail(prev: AdminEventState, formError: string): AdminEventState {
  return { ok: false, formError, version: nextVersion(prev) };
}

function succeed(prev: AdminEventState, notice: string): AdminEventState {
  return { ok: true, notice, version: nextVersion(prev) };
}

// --- Running agents --------------------------------------------------------

export async function runAgentAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const eventId = str(formData, "event_id");
  const type = str(formData, "agent_type");
  const additionalInstructions = str(formData, "additional_instructions").trim();
  const previousRunId = str(formData, "previous_run_id");

  if (!z.uuid().safeParse(eventId).success) {
    return fail(prevState, "We couldn't find that event.");
  }
  const definition = getAgentDefinition(type);
  if (!definition) return fail(prevState, "That's not an agent we know about.");

  const outcome = previousRunId
    ? await rerunAgent({
        eventId,
        type: type as AgentType,
        previousRunId,
        additionalInstructions: additionalInstructions || undefined,
      })
    : await runAgent({
        eventId,
        type: type as AgentType,
        additionalInstructions: additionalInstructions || undefined,
      });

  revalidatePath(`/admin/events/${eventId}/agents`);
  revalidatePath(`/admin/events/${eventId}`);

  if (!outcome.ok) {
    return fail(prevState, outcome.reason);
  }
  return succeed(
    prevState,
    `${definition.label} finished — ${outcome.assetIds.length} draft(s) waiting for review.`,
  );
}

// --- Reviewing assets ------------------------------------------------------

type ReviewOutcome =
  | { kind: "not_found" }
  | { kind: "superseded" }
  | { kind: "ok"; eventId: string; status: string };

export async function reviewAssetAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const assetId = str(formData, "asset_id");
  const decision = str(formData, "decision") as ReviewDecision;
  const rawNote = str(formData, "note").trim();

  if (!z.uuid().safeParse(assetId).success) {
    return fail(prevState, "We couldn't find that draft.");
  }
  if (!REVIEW_DECISIONS.includes(decision)) {
    return fail(prevState, "That isn't a review decision.");
  }
  const parsedNote = noteSchema.safeParse(rawNote === "" ? undefined : rawNote);
  if (!parsedNote.success) {
    return fail(prevState, parsedNote.error.issues[0]?.message ?? "Note is too long");
  }
  if (decision !== "approve" && !parsedNote.data) {
    // A rejection with no reason is unusable — the re-run has nothing to act on.
    return fail(prevState, "Say what needs to change, so a re-run has something to work with.");
  }

  let outcome: ReviewOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const [asset] = await tx
        .select({
          id: generatedAssets.id,
          eventId: generatedAssets.eventId,
          type: generatedAssets.type,
          version: generatedAssets.version,
          reviewStatus: generatedAssets.reviewStatus,
        })
        .from(generatedAssets)
        .where(eq(generatedAssets.id, assetId))
        .for("update")
        .limit(1);
      if (!asset) return { kind: "not_found" as const };

      const [latest] = await tx
        .select({ version: generatedAssets.version })
        .from(generatedAssets)
        .where(
          and(
            eq(generatedAssets.eventId, asset.eventId),
            eq(generatedAssets.type, asset.type),
          ),
        )
        .orderBy(desc(generatedAssets.version))
        .limit(1);
      if (latest && latest.version !== asset.version) {
        return { kind: "superseded" as const };
      }

      const status = DECISION_STATUS[decision];
      const now = new Date();
      await tx
        .update(generatedAssets)
        .set({ reviewStatus: status, reviewNote: parsedNote.data ?? null, updatedAt: now })
        .where(eq(generatedAssets.id, asset.id));

      await tx.insert(auditLog).values({
        eventId: asset.eventId,
        actor: ACTOR_WR_ADMIN,
        action: `generated_asset.${status}`,
        entity: "generated_asset",
        fromValue: asset.reviewStatus,
        toValue: status,
        // Ids and the decision only — the note can quote the draft, so it stays
        // on the asset rather than being copied into the audit log.
        metadata: {
          eventId: asset.eventId,
          assetId: asset.id,
          assetType: asset.type,
          version: asset.version,
        },
      });

      return { kind: "ok" as const, eventId: asset.eventId, status };
    });
  } catch (err) {
    console.error("[agents] reviewAssetAction failed", err);
    return fail(prevState, "Something went wrong recording that decision. Please try again.");
  }

  if (outcome.kind === "not_found") return fail(prevState, "We couldn't find that draft.");
  if (outcome.kind === "superseded") {
    return fail(
      prevState,
      "A newer version of this document exists — review that one instead.",
    );
  }

  revalidatePath(`/admin/events/${outcome.eventId}/agents`);
  revalidatePath(`/admin/events/${outcome.eventId}/assets/${assetId}`);

  const copy: Record<string, string> = {
    approved: "Approved.",
    edit_requested: "Sent back for edits — re-run the agent to act on your note.",
    rejected: "Rejected.",
  };
  return succeed(prevState, copy[outcome.status] ?? "Recorded.");
}

// --- Editing and approving -------------------------------------------------

type EditOutcome =
  | { kind: "not_found" }
  | { kind: "superseded" }
  | { kind: "ok"; eventId: string; assetId: string; version: number };

/**
 * Store a human-edited version and approve it in one step.
 *
 * The new row has `agent_run_id = null` — that is what distinguishes "a person
 * wrote this" from "an agent wrote this", and it keeps the agent's original
 * intact at the previous version.
 */
export async function editAndApproveAssetAction(
  prevState: AdminEventState,
  formData: FormData,
): Promise<AdminEventState> {
  const assetId = str(formData, "asset_id");
  const title = str(formData, "title").trim();
  const body = str(formData, "body");

  if (!z.uuid().safeParse(assetId).success) {
    return fail(prevState, "We couldn't find that draft.");
  }
  if (body.trim() === "") {
    return fail(prevState, "The document can't be empty.");
  }
  if (body.length > 200_000) {
    return fail(prevState, "That document is too long to save.");
  }

  // Same rule as an agent's output: a human-edited document can't carry
  // credentials into the repo either.
  const findings = findSecrets(`${title}\n${body}`);
  if (findings.length > 0) {
    return fail(prevState, describeSecretFindings(findings));
  }

  let outcome: EditOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const [asset] = await tx
        .select({
          id: generatedAssets.id,
          eventId: generatedAssets.eventId,
          type: generatedAssets.type,
          version: generatedAssets.version,
          platform: generatedAssets.platform,
        })
        .from(generatedAssets)
        .where(eq(generatedAssets.id, assetId))
        .for("update")
        .limit(1);
      if (!asset) return { kind: "not_found" as const };

      const [latest] = await tx
        .select({ version: generatedAssets.version })
        .from(generatedAssets)
        .where(
          and(
            eq(generatedAssets.eventId, asset.eventId),
            eq(generatedAssets.type, asset.type),
          ),
        )
        .orderBy(desc(generatedAssets.version))
        .for("update")
        .limit(1);
      if (latest && latest.version !== asset.version) {
        return { kind: "superseded" as const };
      }

      const version = asset.version + 1;
      const [row] = await tx
        .insert(generatedAssets)
        .values({
          eventId: asset.eventId,
          // Null run id: a person wrote this version, not an agent.
          agentRunId: null,
          type: asset.type,
          title: title || null,
          body,
          platform: asset.platform,
          version,
          reviewStatus: "approved",
          reviewNote: "Edited and approved by WR Admin.",
        })
        .returning({ id: generatedAssets.id });

      await tx.insert(auditLog).values({
        eventId: asset.eventId,
        actor: ACTOR_WR_ADMIN,
        action: "generated_asset.edited",
        entity: "generated_asset",
        fromValue: String(asset.version),
        toValue: String(version),
        metadata: {
          eventId: asset.eventId,
          assetId: row.id,
          supersedes: asset.id,
          assetType: asset.type,
        },
      });

      return { kind: "ok" as const, eventId: asset.eventId, assetId: row.id, version };
    });
  } catch (err) {
    console.error("[agents] editAndApproveAssetAction failed", err);
    return fail(prevState, "Something went wrong saving your edit. Please try again.");
  }

  if (outcome.kind === "not_found") return fail(prevState, "We couldn't find that draft.");
  if (outcome.kind === "superseded") {
    return fail(
      prevState,
      "A newer version of this document exists — edit that one instead.",
    );
  }

  revalidatePath(`/admin/events/${outcome.eventId}/agents`);
  revalidatePath(`/admin/events/${outcome.eventId}/assets/${outcome.assetId}`);
  return succeed(
    prevState,
    `Saved as version ${outcome.version} and approved. The agent's draft is kept as version ${outcome.version - 1}.`,
  );
}

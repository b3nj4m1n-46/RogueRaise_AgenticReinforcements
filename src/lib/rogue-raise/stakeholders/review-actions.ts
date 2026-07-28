"use server";

/**
 * Stakeholder review writes (PRD §11.2, `admin_and_stakeholders`).
 *
 * Every write re-verifies the magic-link token and is scoped to the event that
 * token names — a stakeholder for Event A must never comment on Event B's
 * drafts, which is the same scoping rule §12 states for reads.
 *
 * A decision is always accompanied by a comment when it asks for changes: an
 * unexplained "needs changes" gives the re-run nothing to act on, which is the
 * same rule the admin review gate enforces on itself.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLog, generatedAssets, repoReviewComments } from "../db/schema";
import {
  redeemStakeholderReviewToken,
  reviewAccessMessage,
} from "./access";
import { needsStakeholderReview, STAKEHOLDER_AUTHOR_ROLE } from "./review";
import type { ReviewFormState } from "./review-state";

const MAX_COMMENT = 4000;

export async function submitStakeholderReview(
  prevState: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const eventId = String(formData.get("event_id") ?? "");
  const token = String(formData.get("token") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  const rawDecision = String(formData.get("decision") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const version = (prevState.version ?? 0) + 1;

  const fail = (formError: string): ReviewFormState => ({
    ok: false,
    assetId,
    formError,
    version,
  });

  const access = await redeemStakeholderReviewToken({ rawToken: token, eventId });
  if (!access.ok) return fail(reviewAccessMessage(access.reason));

  const decision =
    rawDecision === "approve" || rawDecision === "request_changes"
      ? rawDecision
      : null;

  if (!decision && !body) {
    return fail("Add a comment, or choose whether this looks right.");
  }
  if (decision === "request_changes" && !body) {
    // Same rule the admin gate holds itself to: a re-run needs something to
    // work with, and "no" on its own isn't it.
    return fail("Tell us what needs changing, so we can put it right.");
  }
  if (body.length > MAX_COMMENT) {
    return fail(`Please keep it under ${MAX_COMMENT} characters.`);
  }

  const [asset] = await db
    .select({
      id: generatedAssets.id,
      eventId: generatedAssets.eventId,
      type: generatedAssets.type,
    })
    .from(generatedAssets)
    .where(and(eq(generatedAssets.id, assetId), eq(generatedAssets.eventId, eventId)))
    .limit(1);
  // Scoped in the query: another event's draft is simply not found.
  if (!asset) return fail("We couldn't find that document.");
  if (!needsStakeholderReview(asset.type)) {
    return fail("That document isn't part of your review.");
  }

  const label = access.access.stakeholder.name;

  await db.transaction(async (tx) => {
    await tx.insert(repoReviewComments).values({
      eventId,
      assetId,
      authorRole: STAKEHOLDER_AUTHOR_ROLE,
      authorLabel: label,
      body: body || (decision === "approve" ? "Looks right to me." : ""),
      decision,
    });
    await tx.insert(auditLog).values({
      eventId,
      // Named, because the admin's override decision depends on knowing who.
      actor: `stakeholder:${access.access.stakeholder.id}`,
      action: decision
        ? `generated_asset.stakeholder_${decision}`
        : "generated_asset.stakeholder_commented",
      entity: "generated_asset",
      toValue: decision,
      metadata: {
        assetId,
        stakeholderId: access.access.stakeholder.id,
        assetType: asset.type,
      },
    });
  });

  revalidatePath(`/review/${eventId}`);
  revalidatePath(`/admin/events/${eventId}/assets/${assetId}`);
  return { ok: true, assetId, version };
}

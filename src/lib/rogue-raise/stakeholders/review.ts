/**
 * Stakeholder review of generated drafts (PRD §11.2, `admin_and_stakeholders`).
 *
 * This surface was owed by three stories — asset review, repo review, and the
 * handoff portal each deferred it. It exists because of one line in the PRD:
 * *"WR Admin (and Stakeholders where noted) must Approve/Edit/Reject"*, and
 * because the documents in question are the ones that describe the sponsoring
 * organization's own problem back to it. Getting those wrong in public is worse
 * than getting them late.
 *
 * DELIBERATELY NOT a `"use server"` module — the writes live in
 * `review-actions.ts`; these are readers called from Server Components that
 * have already redeemed a stakeholder token.
 *
 * **The stakeholder's decision advises; it does not auto-publish or auto-block.**
 * A stakeholder cannot approve something into the world, and a busy stakeholder
 * who never answers cannot stall an event indefinitely. What their decision does
 * is make itself impossible to miss: an admin approving an asset with an
 * outstanding "needs changes" has to override deliberately, and the override is
 * audited. That is the honest reading of "must review" for people who don't work
 * here.
 */
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { generatedAssets, repoReviewComments } from "../db/schema";
import { AGENT_CATALOG, type AssetType } from "../agents/catalog";

export const STAKEHOLDER_AUTHOR_ROLE = "stakeholder" as const;

/** Asset types whose agent names stakeholders in its review gate. */
export const STAKEHOLDER_REVIEWED_TYPES: AssetType[] = Object.values(AGENT_CATALOG)
  .filter((agent) => agent.reviewGate === "admin_and_stakeholders")
  .flatMap((agent) => [...agent.assetTypes]);

export function needsStakeholderReview(assetType: string): boolean {
  return STAKEHOLDER_REVIEWED_TYPES.includes(assetType as AssetType);
}

export type StakeholderDecision = "approve" | "request_changes";

export interface ReviewComment {
  id: string;
  authorRole: string;
  authorLabel: string | null;
  body: string;
  decision: string | null;
  createdAt: string;
}

export interface ReviewableAsset {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  version: number;
  reviewStatus: string;
  comments: ReviewComment[];
  /** This stakeholder's most recent decision on this version, if any. */
  ownDecision: StakeholderDecision | null;
}

/**
 * The latest version of each stakeholder-reviewed asset for an event.
 *
 * Only the latest: asking someone outside the building to read four versions of
 * the same document is how you get no review at all.
 */
export async function loadReviewableAssets(
  eventId: string,
  stakeholderLabel: string,
): Promise<ReviewableAsset[]> {
  if (STAKEHOLDER_REVIEWED_TYPES.length === 0) return [];

  const rows = await db
    .select()
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.eventId, eventId),
        inArray(generatedAssets.type, STAKEHOLDER_REVIEWED_TYPES),
      ),
    )
    .orderBy(asc(generatedAssets.type), desc(generatedAssets.version));

  // One per type — the rows are already newest-first within each type.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.type)) latest.set(row.type, row);
  }
  const assets = [...latest.values()];
  if (assets.length === 0) return [];

  const commentRows = await db
    .select()
    .from(repoReviewComments)
    .where(
      and(
        eq(repoReviewComments.eventId, eventId),
        isNotNull(repoReviewComments.assetId),
      ),
    )
    .orderBy(asc(repoReviewComments.createdAt));

  return assets.map((asset) => {
    const comments = commentRows.filter((c) => c.assetId === asset.id);
    const own = comments
      .filter(
        (c) =>
          c.authorRole === STAKEHOLDER_AUTHOR_ROLE &&
          c.authorLabel === stakeholderLabel &&
          c.decision !== null,
      )
      .at(-1);

    return {
      id: asset.id,
      type: asset.type,
      title: asset.title,
      body: asset.body,
      version: asset.version,
      reviewStatus: asset.reviewStatus,
      comments: comments.map((c) => ({
        id: c.id,
        authorRole: c.authorRole,
        authorLabel: c.authorLabel,
        body: c.body,
        decision: c.decision,
        createdAt: c.createdAt.toISOString(),
      })),
      ownDecision: (own?.decision as StakeholderDecision | undefined) ?? null,
    };
  });
}

export interface StakeholderVerdict {
  assetId: string;
  /** Latest decision per stakeholder, newest last. */
  decisions: { label: string | null; decision: string; at: string }[];
  approvals: number;
  changesRequested: number;
}

/**
 * What the ADMIN sees on the asset review page: whether anyone outside the
 * building has looked at this, and what they said.
 */
export async function loadStakeholderVerdicts(
  eventId: string,
): Promise<Map<string, StakeholderVerdict>> {
  const rows = await db
    .select()
    .from(repoReviewComments)
    .where(
      and(
        eq(repoReviewComments.eventId, eventId),
        eq(repoReviewComments.authorRole, STAKEHOLDER_AUTHOR_ROLE),
        isNotNull(repoReviewComments.assetId),
        isNotNull(repoReviewComments.decision),
      ),
    )
    .orderBy(asc(repoReviewComments.createdAt));

  const byAsset = new Map<string, StakeholderVerdict>();
  for (const row of rows) {
    const assetId = row.assetId!;
    const verdict = byAsset.get(assetId) ?? {
      assetId,
      decisions: [],
      approvals: 0,
      changesRequested: 0,
    };
    // One entry per person — a stakeholder who changes their mind replaces
    // their own earlier decision rather than being counted twice.
    const existing = verdict.decisions.findIndex((d) => d.label === row.authorLabel);
    const entry = {
      label: row.authorLabel,
      decision: row.decision!,
      at: row.createdAt.toISOString(),
    };
    if (existing >= 0) verdict.decisions[existing] = entry;
    else verdict.decisions.push(entry);
    byAsset.set(assetId, verdict);
  }

  for (const verdict of byAsset.values()) {
    verdict.approvals = verdict.decisions.filter((d) => d.decision === "approve").length;
    verdict.changesRequested = verdict.decisions.filter(
      (d) => d.decision === "request_changes",
    ).length;
  }

  return byAsset;
}

/**
 * Shared reader for the approved documents a repo is built from.
 *
 * Both provisioning and repo review need "the latest version of each asset
 * type, approved only" — extracted so the two can never disagree about which
 * documents are in the repo.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "../db";
import { generatedAssets } from "../db/schema";

export interface ApprovedAsset {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  version: number;
  reviewStatus: string;
}

/**
 * Latest version of every asset type, whatever its review status. Repo assets
 * never carry a platform (only social posts do), so keying on type alone is
 * correct here.
 */
export async function latestAssetsByType(
  eventId: string,
): Promise<Map<string, ApprovedAsset>> {
  const rows = await db
    .select({
      id: generatedAssets.id,
      type: generatedAssets.type,
      title: generatedAssets.title,
      body: generatedAssets.body,
      version: generatedAssets.version,
      reviewStatus: generatedAssets.reviewStatus,
    })
    .from(generatedAssets)
    .where(eq(generatedAssets.eventId, eventId))
    .orderBy(generatedAssets.type, desc(generatedAssets.version));

  const latest = new Map<string, ApprovedAsset>();
  for (const row of rows) if (!latest.has(row.type)) latest.set(row.type, row);
  return latest;
}

/** Only the approved ones — what may actually be pushed. */
export async function latestApprovedAssets(
  eventId: string,
): Promise<ApprovedAsset[]> {
  const latest = await latestAssetsByType(eventId);
  return [...latest.values()].filter((a) => a.reviewStatus === "approved");
}

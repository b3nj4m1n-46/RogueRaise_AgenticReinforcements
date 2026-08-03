/**
 * Agent read model for the console.
 *
 * DELIBERATELY NOT a `"use server"` module — exports there become POST
 * endpoints, and these readers are keyed only on ids. They are reachable only
 * from Server Components already behind the `/admin` env gate.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { agentRuns, generatedAssets } from "../db/schema";
import { getAgentDefinition, type AgentType } from "./catalog";

export interface AgentRunView {
  id: string;
  type: string;
  label: string;
  status: string;
  costTokens: number;
  logs: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Present when this run was a re-attempt. */
  parentRunId: string | null;
  additionalInstructions: string | null;
}

export interface AssetView {
  id: string;
  type: string;
  /** Only set for social posts. */
  platform: string | null;
  title: string | null;
  body: string | null;
  blobUrl: string | null;
  version: number;
  reviewStatus: string;
  reviewNote: string | null;
  /** Null when a human wrote this version by editing the agent's draft. */
  agentRunId: string | null;
  createdAt: string;
}

function readInputs(inputs: unknown): Record<string, unknown> {
  return inputs && typeof inputs === "object" ? (inputs as Record<string, unknown>) : {};
}

export async function listAgentRuns(eventId: string): Promise<AgentRunView[]> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.eventId, eventId))
    .orderBy(desc(agentRuns.createdAt));

  return rows.map((row) => {
    const inputs = readInputs(row.inputs);
    return {
      id: row.id,
      type: row.type,
      label: getAgentDefinition(row.type)?.label ?? row.type,
      status: row.status,
      costTokens: row.costTokens,
      logs: row.logs,
      error: row.error,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      parentRunId:
        typeof inputs.parentRunId === "string" ? inputs.parentRunId : null,
      additionalInstructions:
        typeof inputs.additionalInstructions === "string"
          ? inputs.additionalInstructions
          : null,
    };
  });
}

export async function listAssets(eventId: string): Promise<AssetView[]> {
  const rows = await db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.eventId, eventId))
    .orderBy(generatedAssets.type, generatedAssets.platform, desc(generatedAssets.version));

  return rows.map(toAssetView);
}

/**
 * Latest version of each asset type, plus how many older versions exist — what
 * the console shows by default, since only the latest is actionable.
 */
export interface AssetGroup {
  type: string;
  /** Set for social posts, which are grouped per platform. */
  platform: string | null;
  latest: AssetView;
  olderVersions: AssetView[];
}

/** Groups share a key with the version counter: (type, platform). */
function groupKey(asset: { type: string; platform: string | null }): string {
  return asset.platform ? `${asset.type}:${asset.platform}` : asset.type;
}

export async function listAssetGroups(eventId: string): Promise<AssetGroup[]> {
  const assets = await listAssets(eventId);
  const groups = new Map<string, AssetGroup>();

  for (const asset of assets) {
    const key = groupKey(asset);
    const existing = groups.get(key);
    if (!existing) {
      // Ordered by version desc, so the first of each key is the latest.
      groups.set(key, {
        type: asset.type,
        platform: asset.platform,
        latest: asset,
        olderVersions: [],
      });
      continue;
    }
    existing.olderVersions.push(asset);
  }

  return [...groups.values()];
}

export async function loadAsset(assetId: string): Promise<AssetView | null> {
  const [row] = await db
    .select()
    .from(generatedAssets)
    .where(eq(generatedAssets.id, assetId))
    .limit(1);
  return row ? toAssetView(row) : null;
}

/** True when this asset is the newest version of its type for its event. */
export async function isLatestVersion(asset: {
  eventId: string;
  type: string;
  version: number;
}): Promise<boolean> {
  const [latest] = await db
    .select({ version: generatedAssets.version })
    .from(generatedAssets)
    .where(
      and(
        eq(generatedAssets.eventId, asset.eventId),
        eq(generatedAssets.type, asset.type as "research_doc"),
      ),
    )
    .orderBy(desc(generatedAssets.version))
    .limit(1);
  return latest?.version === asset.version;
}

/** Agents that could be started right now, given the event's status. */
export function triggerableAgents(eventStatus: string, catalog: AgentType[]) {
  return catalog.filter((type) =>
    getAgentDefinition(type)?.triggerStatuses.includes(eventStatus),
  );
}

type AssetRow = typeof generatedAssets.$inferSelect;

function toAssetView(row: AssetRow): AssetView {
  return {
    id: row.id,
    type: row.type,
    platform: row.platform,
    title: row.title,
    body: row.body,
    blobUrl: row.blobUrl,
    version: row.version,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
    agentRunId: row.agentRunId,
    createdAt: row.createdAt.toISOString(),
  };
}

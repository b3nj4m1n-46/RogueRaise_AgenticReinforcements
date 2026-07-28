/**
 * `AgentRun` lifecycle and `GeneratedAsset` persistence — the ONLY module that
 * writes either table (PRD §11.1).
 *
 * Guarantees it owns, so no handler has to remember them:
 *   - Every run is a row from the moment it starts, with `inputs`, `logs`,
 *     `cost_tokens`, and timestamps. A process that dies mid-run leaves a
 *     `running` row that `reclaimStaleRuns` can honestly mark failed — which is
 *     what makes a run recoverable at all.
 *   - Every status change is audit-logged with from→to.
 *   - Every asset is attributed to its run and versioned per (event, asset
 *     type), with the version computed under a lock so two concurrent runs
 *     can't both claim version 3.
 *   - Every asset lands `review_status: "pending"`. Nothing auto-publishes.
 *   - Content is scanned for credential material and REFUSED if found.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db } from "../db";
import { agentRuns, auditLog, events, generatedAssets, organizations } from "../db/schema";
import {
  canTriggerAgent,
  describeTriggerStatuses,
  getAgentDefinition,
  producesAssetType,
  type AgentType,
} from "./catalog";
import type { AgentEventContext, DraftAsset } from "./registry";
import { describeSecretFindings, findSecrets } from "./secrets";

/** Audit actor for agent-driven changes; distinct from `wr-admin` and `public`. */
export const ACTOR_AGENT = "agent";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown when an agent is asked to run in a phase it isn't allowed in. */
export class AgentNotTriggerableError extends Error {
  constructor(
    readonly agentType: string,
    readonly eventStatus: string,
  ) {
    super(
      `"${agentType}" can't run while the event is "${eventStatus}" — it runs during: ${describeTriggerStatuses(agentType)}.`,
    );
    this.name = "AgentNotTriggerableError";
  }
}

/** Thrown when a handler returns an asset type its agent never declared. */
export class UndeclaredAssetTypeError extends Error {
  constructor(agentType: string, assetType: string) {
    super(`"${agentType}" is not declared to produce "${assetType}" assets.`);
    this.name = "UndeclaredAssetTypeError";
  }
}

/** Thrown when generated content contains credential material. */
export class SecretMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretMaterialError";
  }
}

export interface StartRunInput {
  eventId: string;
  type: AgentType;
  inputs?: Record<string, unknown>;
  /** Set when this run is a re-attempt; recorded in `inputs` for the audit chain. */
  parentRunId?: string;
  additionalInstructions?: string;
}

export interface StartedRun {
  runId: string;
  event: AgentEventContext;
}

/**
 * Create the run row and mark it running, gating on `Event.status` first. The
 * event row is locked so a status change mid-decision can't slip past the gate.
 */
export async function startRun(input: StartRunInput): Promise<StartedRun> {
  const definition = getAgentDefinition(input.type);
  if (!definition) throw new Error(`Unknown agent type "${input.type}".`);

  type StartOutcome =
    | { kind: "refused"; eventId: string; eventStatus: string }
    | { kind: "ok"; started: StartedRun };

  const outcome: StartOutcome = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        id: events.id,
        title: events.title,
        slug: events.slug,
        status: events.status,
        orgId: events.orgId,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update")
      .limit(1);
    if (!event) throw new Error("Event not found.");

    if (!canTriggerAgent(input.type, event.status)) {
      // Return rather than throw: throwing here would roll back the very audit
      // row that records the refusal. The row is written after the commit.
      return { kind: "refused" as const, eventId: event.id, eventStatus: event.status };
    }

    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, event.orgId))
      .limit(1);

    const now = new Date();
    const inputs = {
      ...(input.inputs ?? {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.additionalInstructions
        ? { additionalInstructions: input.additionalInstructions }
        : {}),
      triggeredAtStatus: event.status,
    };

    const [run] = await tx
      .insert(agentRuns)
      .values({
        eventId: event.id,
        type: input.type,
        status: "running",
        inputs,
        startedAt: now,
      })
      .returning({ id: agentRuns.id });

    await tx.insert(auditLog).values({
      eventId: event.id,
      actor: ACTOR_AGENT,
      action: "agent_run.running",
      entity: "agent_run",
      fromValue: "queued",
      toValue: "running",
      metadata: {
        eventId: event.id,
        agentRunId: run.id,
        agentType: input.type,
        parentRunId: input.parentRunId ?? null,
      },
    });

    return {
      kind: "ok" as const,
      started: {
        runId: run.id,
        event: {
          id: event.id,
          title: event.title,
          slug: event.slug,
          status: event.status,
          organizationName: org?.name ?? "",
        },
      },
    };
  });

  if (outcome.kind === "refused") {
    // Recorded, not just refused — a blocked trigger is worth seeing in the log.
    await db.insert(auditLog).values({
      eventId: outcome.eventId,
      actor: ACTOR_AGENT,
      action: "agent_run.refused",
      entity: "agent_run",
      fromValue: outcome.eventStatus,
      toValue: input.type,
      metadata: { eventId: outcome.eventId, agentType: input.type },
    });
    throw new AgentNotTriggerableError(input.type, outcome.eventStatus);
  }

  return outcome.started;
}

/**
 * Persist a handler's drafts. Version per (event, asset type) is read under a
 * lock inside this transaction, so concurrent runs serialize rather than
 * colliding. Refuses undeclared asset types and any credential material.
 */
export async function writeAssets(
  tx: Tx,
  runId: string,
  eventId: string,
  agentType: string,
  assets: DraftAsset[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const asset of assets) {
    if (!producesAssetType(agentType, asset.type)) {
      throw new UndeclaredAssetTypeError(agentType, asset.type);
    }

    const content = [asset.title, asset.body].filter(Boolean).join("\n");
    const findings = findSecrets(content);
    if (findings.length > 0) {
      throw new SecretMaterialError(describeSecretFindings(findings));
    }

    // Lock the existing versions of this (event, type) so the MAX we read is
    // still the MAX when we insert.
    const [previous] = await tx
      .select({ version: generatedAssets.version })
      .from(generatedAssets)
      .where(
        and(
          eq(generatedAssets.eventId, eventId),
          eq(generatedAssets.type, asset.type),
        ),
      )
      .orderBy(desc(generatedAssets.version))
      .for("update")
      .limit(1);

    const [row] = await tx
      .insert(generatedAssets)
      .values({
        eventId,
        agentRunId: runId,
        type: asset.type,
        title: asset.title ?? null,
        body: asset.body ?? null,
        blobUrl: asset.blobUrl ?? null,
        platform: asset.platform ?? null,
        version: (previous?.version ?? 0) + 1,
        // Human-in-the-loop is mandatory — there is no path that sets this to
        // anything else at creation time.
        reviewStatus: "pending",
      })
      .returning({ id: generatedAssets.id });

    ids.push(row.id);
  }

  return ids;
}

export interface FinishRunInput {
  runId: string;
  eventId: string;
  status: "succeeded" | "failed" | "paused_for_review";
  logs: string;
  costTokens: number;
  error?: string;
  assets?: DraftAsset[];
  agentType: string;
}

export interface FinishedRun {
  runId: string;
  assetIds: string[];
}

/**
 * Write the run's outcome — and its assets, in the same transaction, so a run
 * can never be `succeeded` with its assets missing.
 */
export async function finishRun(input: FinishRunInput): Promise<FinishedRun> {
  return db.transaction(async (tx) => {
    const assetIds =
      input.status === "succeeded" && input.assets?.length
        ? await writeAssets(tx, input.runId, input.eventId, input.agentType, input.assets)
        : [];

    const now = new Date();
    await tx
      .update(agentRuns)
      .set({
        status: input.status,
        logs: input.logs,
        costTokens: input.costTokens,
        error: input.error ?? null,
        finishedAt: input.status === "paused_for_review" ? null : now,
        updatedAt: now,
      })
      .where(eq(agentRuns.id, input.runId));

    await tx.insert(auditLog).values({
      eventId: input.eventId,
      actor: ACTOR_AGENT,
      action: `agent_run.${input.status}`,
      entity: "agent_run",
      fromValue: "running",
      toValue: input.status,
      metadata: {
        eventId: input.eventId,
        agentRunId: input.runId,
        agentType: input.agentType,
        assetCount: assetIds.length,
        costTokens: input.costTokens,
      },
    });

    return { runId: input.runId, assetIds };
  });
}

/** How long a `running` run may go untouched before it's presumed dead. */
export const STALE_RUN_MS = 15 * 60 * 1000;

/**
 * Mark long-abandoned `running` rows as failed.
 *
 * Without this, a process that dies mid-run leaves a row that looks in-flight
 * forever, and staff have no way to tell "still working" from "died an hour
 * ago". The reclaimed run says exactly what happened rather than inventing a
 * cause, and re-running is then the normal path.
 */
export async function reclaimStaleRuns(
  olderThanMs: number = STALE_RUN_MS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs);

  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: agentRuns.id, eventId: agentRuns.eventId, type: agentRuns.type })
      .from(agentRuns)
      .where(and(eq(agentRuns.status, "running"), lt(agentRuns.startedAt, cutoff)))
      .for("update");
    if (stale.length === 0) return 0;

    await tx
      .update(agentRuns)
      .set({
        status: "failed",
        error:
          "Run was interrupted — the process handling it stopped before finishing. Re-run to try again.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        inArray(
          agentRuns.id,
          stale.map((r) => r.id),
        ),
      );

    for (const run of stale) {
      await tx.insert(auditLog).values({
        eventId: run.eventId,
        actor: "system",
        action: "agent_run.failed",
        entity: "agent_run",
        fromValue: "running",
        toValue: "failed",
        metadata: { eventId: run.eventId, agentRunId: run.id, reason: "stale" },
      });
    }

    return stale.length;
  });
}

/** Total tokens spent by all runs for an event — the cost line in the console. */
export async function totalCostForEvent(eventId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${agentRuns.costTokens}), 0)` })
    .from(agentRuns)
    .where(eq(agentRuns.eventId, eventId));
  return Number(row?.total ?? 0);
}

/**
 * Agent handler registry.
 *
 * A handler is a pure-ish function: it receives everything it needs (the event
 * snapshot, its inputs, a model adapter, a log sink) and returns draft assets as
 * plain data. **Handlers never touch the database.** All persistence lives in
 * `runs.ts`, so run auditing, asset versioning, and the secret scan can't be
 * bypassed by a handler that forgets to call something.
 *
 * That constraint is what makes the AC "every generated asset is versioned and
 * attributable to its AgentRun" structurally true rather than a convention.
 */
import type { AiAdapter } from "../integrations/ai-gateway";
import type { AgentType, AssetType } from "./catalog";

/** Snapshot of the event the agent is working on — read-only. */
export interface AgentEventContext {
  id: string;
  title: string;
  slug: string;
  status: string;
  organizationName: string;
}

export interface AgentContext {
  runId: string;
  event: AgentEventContext;
  /** Whatever the caller passed; shape is the agent's own business. */
  inputs: Record<string, unknown>;
  /**
   * Extra steer supplied when re-running. Handlers should honour it — it is the
   * mechanism behind "each agent is independently re-runnable with additional
   * instructions" (PRD §11.2).
   */
  additionalInstructions?: string;
  ai: AiAdapter;
  /** Appended to the run's `logs`, which is the incident report when it fails. */
  log(message: string): void;
}

/** What a handler returns. `body` for text assets, `blobUrl` for binary ones. */
export interface DraftAsset {
  type: AssetType;
  title?: string;
  body?: string;
  blobUrl?: string;
  /** Only meaningful for `social_post`. */
  platform?: "instagram" | "facebook" | "x" | "reddit";
}

export interface AgentResult {
  assets: DraftAsset[];
  /** Tokens the handler spent, if it tracked them itself. */
  costTokens?: number;
  /** One line for the run log — what it decided, not what it wrote. */
  summary?: string;
}

export type AgentHandler = (context: AgentContext) => Promise<AgentResult>;

const handlers = new Map<string, AgentHandler>();

export function registerAgentHandler(type: AgentType, handler: AgentHandler): void {
  handlers.set(type, handler);
}

export function getAgentHandler(type: string): AgentHandler | undefined {
  return handlers.get(type);
}

export function hasAgentHandler(type: string): boolean {
  return handlers.has(type);
}

/** Test seam — drops a registration so suites don't leak into each other. */
export function unregisterAgentHandler(type: string): void {
  handlers.delete(type);
}

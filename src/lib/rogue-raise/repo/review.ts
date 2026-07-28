/**
 * Repo review (PRD §5.3.2).
 *
 * The files in the pushed tree are re-derived with the same pure `buildRepoFiles`
 * the push used, so the review shows what is actually in the repo without
 * needing to read it back over the network. That holds as long as the inputs
 * haven't changed since the push — and when they have, the honest answer is
 * that the repo is stale and should be re-provisioned, which the surface says.
 *
 * Feedback is append-only: one row per comment, so a file reads as a thread
 * rather than a single overwritten note. Approving publishes the repo and moves
 * the event to `repo_approved`; requesting changes re-runs the research agent
 * with the feedback as additional instructions, which is the loop PRD §5.3.2
 * asks for.
 */
import { and, asc, eq } from "drizzle-orm";

import { rerunAgent } from "../agents/execute";
import { db } from "../db";
import {
  agentRuns,
  auditLog,
  contextRepos,
  events,
  repoReviewComments,
} from "../db/schema";
import { loadAdminEvent } from "../events/queries";
import { getGithubAdapter } from "../integrations/github";
import { describeSchedule, formatWeekendLabel } from "../intake/schedule";
import { buildRepoFiles, repoNameForEvent } from "./file-set";
import { latestApprovedAssets } from "./assets";

/** Statuses in which the repo can still be reviewed. */
export const REVIEWABLE_STATUSES = ["repo_review", "repo_approved"] as const;

export function canReviewRepo(status: string): boolean {
  return (REVIEWABLE_STATUSES as readonly string[]).includes(status);
}

export interface RepoFileView {
  path: string;
  content: string;
  /** The asset type this file came from, when it came from one. */
  sourceAssetType: string | null;
  /** The asset id, so the reviewer can jump to the editable draft. */
  sourceAssetId: string | null;
  comments: RepoCommentView[];
}

export interface RepoCommentView {
  id: string;
  filePath: string | null;
  authorRole: string;
  authorLabel: string | null;
  body: string;
  decision: string | null;
  createdAt: string;
}

/** Which generated file each asset type ends up in. */
const ASSET_FILE: Record<string, string> = {
  research_doc: "research/README.md",
  stakeholder_preferences: "stakeholder-preferences.md",
  setup_agent_instructions: "setup-agent-instructions.md",
};

export interface RepoReviewView {
  repoUrl: string | null;
  pullRequestUrl: string | null;
  isPublic: boolean;
  files: RepoFileView[];
  /** Comments not attached to a particular file. */
  generalComments: RepoCommentView[];
}

export async function loadRepoReview(eventId: string): Promise<RepoReviewView | null> {
  const detail = await loadAdminEvent(eventId);
  if (!detail) return null;

  const [repo] = await db
    .select()
    .from(contextRepos)
    .where(eq(contextRepos.eventId, eventId))
    .limit(1);

  const assets = await latestApprovedAssets(eventId);
  const files = buildRepoFiles({
    organizationName: detail.organizationName,
    eventTitle: detail.title,
    eventSlug: detail.slug,
    weekendLabel: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
    scheduleLines: detail.confirmedFridayKickoffAt
      ? describeSchedule(new Date(detail.confirmedFridayKickoffAt))
      : [],
    locationName: detail.locationName,
    locationAddress: detail.locationAddress,
    painPoints: detail.application?.painPoints ?? "",
    goalsNeeds: detail.application?.goalsNeeds ?? "",
    supportingContext: detail.intake?.supplementaryInfo ?? "",
    attachmentNames: detail.attachments.map((a) => a.filename),
    technicalStack: detail.intake?.stakeholderTechStack ?? "",
    technicalTags: detail.intake?.stakeholderTechTags ?? [],
    technicalSponsors: detail.techSponsors.map((s) => ({
      name: s.name,
      offering: s.offering,
      status: s.status,
    })),
    evaluativeCriteria: detail.criteria.map((c) => ({
      label: c.label,
      description: c.description,
      weight: c.weight,
    })),
    assets: assets.map((a) => ({
      type: a.type,
      title: a.title,
      body: a.body,
      version: a.version,
    })),
  });

  const comments = await listComments(eventId);
  const byPath = new Map<string, RepoCommentView[]>();
  const general: RepoCommentView[] = [];
  for (const comment of comments) {
    if (!comment.filePath) {
      general.push(comment);
      continue;
    }
    const list = byPath.get(comment.filePath) ?? [];
    list.push(comment);
    byPath.set(comment.filePath, list);
  }

  const assetByFile = new Map<string, { type: string; id: string }>();
  for (const asset of assets) {
    const file = ASSET_FILE[asset.type];
    if (file) assetByFile.set(file, { type: asset.type, id: asset.id });
    if (asset.type === "example_prd") {
      for (const path of Object.keys(files)) {
        if (path.startsWith("prds/")) {
          assetByFile.set(path, { type: asset.type, id: asset.id });
        }
      }
    }
  }

  return {
    repoUrl: repo?.githubRepoUrl ?? null,
    pullRequestUrl: repo?.openPrUrl ?? null,
    isPublic: repo?.isPublic ?? false,
    files: Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({
        path,
        content,
        sourceAssetType: assetByFile.get(path)?.type ?? null,
        sourceAssetId: assetByFile.get(path)?.id ?? null,
        comments: byPath.get(path) ?? [],
      })),
    generalComments: general,
  };
}

export async function listComments(eventId: string): Promise<RepoCommentView[]> {
  const rows = await db
    .select()
    .from(repoReviewComments)
    .where(eq(repoReviewComments.eventId, eventId))
    .orderBy(asc(repoReviewComments.createdAt));
  return rows.map((row) => ({
    id: row.id,
    filePath: row.filePath,
    authorRole: row.authorRole,
    authorLabel: row.authorLabel,
    body: row.body,
    decision: row.decision,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function addComment(input: {
  eventId: string;
  filePath: string | null;
  body: string;
  authorRole?: string;
  decision?: string | null;
}): Promise<void> {
  await db.insert(repoReviewComments).values({
    eventId: input.eventId,
    filePath: input.filePath,
    // No per-person identity until Better Auth lands; the role is what we know.
    authorRole: input.authorRole ?? "wr_admin",
    body: input.body,
    decision: input.decision ?? null,
  });
}

export type RepoDecisionOutcome =
  | { ok: true; notice: string }
  | { ok: false; reason: string };

/**
 * Approve the repo: make it public and move the event to `repo_approved`.
 * Publishing is the last irreversible step before participants can see it, so
 * it happens only here and only from `repo_review`.
 */
export async function approveRepo(eventId: string): Promise<RepoDecisionOutcome> {
  const detail = await loadAdminEvent(eventId);
  if (!detail) return { ok: false, reason: "We couldn't find that event." };
  if (detail.status !== "repo_review") {
    return {
      ok: false,
      reason: `The repo is approved from the review stage — this event is "${detail.status}".`,
    };
  }

  const [repo] = await db
    .select()
    .from(contextRepos)
    .where(eq(contextRepos.eventId, eventId))
    .limit(1);
  if (!repo) return { ok: false, reason: "This event has no context repo yet." };

  try {
    await getGithubAdapter().setVisibility({
      fullName: fullName(repo.githubRepoUrl, detail.slug),
      isPrivate: false,
    });
  } catch (err) {
    console.error("[repo] failed to publish", err);
    return {
      ok: false,
      reason: `Couldn't make the repository public: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(contextRepos)
      .set({ isPublic: true, updatedAt: now })
      .where(eq(contextRepos.id, repo.id));
    await tx
      .update(events)
      .set({ status: "repo_approved", updatedAt: now })
      .where(eq(events.id, eventId));
    await tx.insert(auditLog).values({
      eventId,
      actor: "wr-admin",
      action: "event.repo_approved",
      entity: "event",
      fromValue: "repo_review",
      toValue: "repo_approved",
      metadata: { eventId, repoUrl: repo.githubRepoUrl, madePublic: true },
    });
  });

  return {
    ok: true,
    notice: "Repo approved and made public. The event is ready for registration.",
  };
}

/**
 * Send the repo back: record the feedback and re-run the research agent with it.
 * The re-run produces new document versions, which are reviewed and then
 * re-provisioned — the same loop as any other agent output.
 */
export async function requestRepoChanges(input: {
  eventId: string;
  feedback: string;
}): Promise<RepoDecisionOutcome> {
  const detail = await loadAdminEvent(input.eventId);
  if (!detail) return { ok: false, reason: "We couldn't find that event." };
  if (!canReviewRepo(detail.status)) {
    return {
      ok: false,
      reason: `This event isn't in repo review — it is "${detail.status}".`,
    };
  }

  await addComment({
    eventId: input.eventId,
    filePath: null,
    body: input.feedback,
    decision: "request_changes",
  });

  const [previous] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.eventId, input.eventId),
        eq(agentRuns.type, "context_research_repo"),
      ),
    )
    .orderBy(agentRuns.createdAt);

  if (!previous) {
    return {
      ok: true,
      notice:
        "Feedback recorded. There's no earlier research run to re-run, so draft the documents first.",
    };
  }

  // Every comment so far is context for the re-run, not just the newest one.
  const comments = await listComments(input.eventId);
  const instructions = comments
    .map((c) => (c.filePath ? `${c.filePath}: ${c.body}` : c.body))
    .join("\n");

  const outcome = await rerunAgent({
    eventId: input.eventId,
    type: "context_research_repo",
    previousRunId: previous.id,
    additionalInstructions: instructions,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      reason: `Feedback was recorded, but the re-run failed: ${outcome.reason}`,
    };
  }
  return {
    ok: true,
    notice:
      "Feedback recorded and the agent re-ran. Review the new drafts, then rebuild the repository.",
  };
}

function fullName(url: string, eventSlug: string): string {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (match) return match[1];
  const org = process.env.RR_GITHUB_ORG ?? "white-rabbit-local";
  return `${org}/${repoNameForEvent(eventSlug)}`;
}

/**
 * Context-repo provisioning (PRD §5.3.1 step 3).
 *
 * Turns the APPROVED documents into a real repository: create (private), commit
 * the file tree on a branch, open a PR, record the `ContextRepo`, and move the
 * event `repo_generating → repo_review`.
 *
 * Not an `AgentRun`: nothing here calls a model. It is deterministic assembly
 * and I/O, so it is an audited service rather than a fake agent run — the
 * documents it pushes stay attributed to the runs that wrote them.
 *
 * Two rules shape the error handling:
 *   - **Only approved documents are pushed.** Anything pending, sent back, or
 *     rejected blocks provisioning by name, so the review gate M3b enforces
 *     can't be walked around by provisioning early.
 *   - **A failure restores the previous status.** An event stuck in
 *     `repo_generating` with no repo is the same "in-flight forever" problem the
 *     agent runs already solve, and it deserves the same answer.
 */
import { and, eq } from "drizzle-orm";

import { findSecrets, describeSecretFindings } from "../agents/secrets";
import { db } from "../db";
import { auditLog, contextRepos, events } from "../db/schema";
import { loadAdminEvent } from "../events/queries";
import { getGithubAdapter, type RepoFiles } from "../integrations/github";
import { describeSchedule, formatWeekendLabel } from "../intake/schedule";
import { latestAssetsByType } from "./assets";
import {
  buildRepoFiles,
  repoNameForEvent,
  REQUIRED_ASSET_TYPES,
  type RepoAssetInput,
} from "./file-set";

/** Statuses from which provisioning may start. */
export const PROVISIONABLE_STATUSES = [
  "intake_complete",
  "repo_review",
  "repo_approved",
] as const;

export function canProvisionRepo(status: string): boolean {
  return (PROVISIONABLE_STATUSES as readonly string[]).includes(status);
}

const BRANCH = "rogue-raise/context";

export type ProvisionOutcome =
  | { ok: true; repoUrl: string; pullRequestUrl: string; fileCount: number; updated: boolean }
  | { ok: false; reason: string };

/** Human labels for the required documents, used in blocking messages. */
const ASSET_LABELS: Record<string, string> = {
  research_doc: "Research notes",
  stakeholder_preferences: "Stakeholder preferences",
  example_prd: "Example PRD",
  setup_agent_instructions: "Setup instructions",
};

/**
 * What still stands between this event and a repo. Returned to the console so a
 * staff member sees the blockers before pressing anything.
 */
export async function describeProvisioningBlockers(eventId: string): Promise<string[]> {
  const blockers: string[] = [];
  const latest = await latestAssetsByType(eventId);

  for (const type of REQUIRED_ASSET_TYPES) {
    const asset = latest.get(type);
    const label = ASSET_LABELS[type] ?? type;
    if (!asset) {
      blockers.push(`${label} hasn't been drafted yet.`);
    } else if (asset.reviewStatus !== "approved") {
      blockers.push(`${label} is ${asset.reviewStatus.replace(/_/g, " ")} — it needs approving.`);
    }
  }
  return blockers;
}

export async function provisionContextRepo(
  eventId: string,
  actor: string,
): Promise<ProvisionOutcome> {
  const detail = await loadAdminEvent(eventId);
  if (!detail) return { ok: false, reason: "We couldn't find that event." };
  if (!canProvisionRepo(detail.status)) {
    return {
      ok: false,
      reason: `A context repo is built once the intake is complete and the documents are approved — this event is "${detail.status}".`,
    };
  }

  const blockers = await describeProvisioningBlockers(eventId);
  if (blockers.length > 0) {
    return { ok: false, reason: blockers.join(" ") };
  }

  const latest = await latestAssetsByType(eventId);
  const assets: RepoAssetInput[] = [...latest.values()]
    .filter((a) => a.reviewStatus === "approved")
    .map((a) => ({ type: a.type, title: a.title, body: a.body, version: a.version }));

  const schedule = detail.confirmedFridayKickoffAt
    ? describeSchedule(new Date(detail.confirmedFridayKickoffAt))
    : [];

  const files = buildRepoFiles({
    organizationName: detail.organizationName,
    eventTitle: detail.title,
    eventSlug: detail.slug,
    weekendLabel: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
    scheduleLines: schedule,
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
    assets,
  });

  // Scan EVERY file before anything is pushed. A partial tree in a repo
  // participants will read is worse than no tree at all.
  const secretBlockers = scanFiles(files);
  if (secretBlockers) return { ok: false, reason: secretBlockers };

  const previousStatus = detail.status;
  await setStatus(eventId, "repo_generating", previousStatus, actor);

  try {
    const github = getGithubAdapter();
    const [existing] = await db
      .select()
      .from(contextRepos)
      .where(eq(contextRepos.eventId, eventId))
      .limit(1);

    // Idempotent per event: a second attempt updates the same repo.
    const repo = existing
      ? {
          url: existing.githubRepoUrl,
          defaultBranch: existing.defaultBranch,
          fullName: fullNameFromUrl(existing.githubRepoUrl, detail.slug),
        }
      : await github.createRepo({
          name: repoNameForEvent(detail.slug),
          description: `Context repo for ${detail.title} — a Rogue Raise with ${detail.organizationName}.`,
          // Private during review; made public at approval (PRD §5.3.1).
          isPrivate: true,
        });

    await github.putFiles({
      fullName: repo.fullName,
      branch: BRANCH,
      baseBranch: repo.defaultBranch,
      message: existing
        ? "Update context from the approved Rogue Raise documents"
        : "Add context from the approved Rogue Raise documents",
      files,
    });

    const pr = await github.openPullRequest({
      fullName: repo.fullName,
      head: BRANCH,
      base: repo.defaultBranch,
      title: `Context for ${detail.title}`,
      body: [
        `Generated from the approved intake documents for **${detail.organizationName}**.`,
        "",
        "Every document in this PR was drafted by an agent and approved by White Rabbit staff before it was pushed.",
        "",
        "No credentials are included — `tools/README.md` explains how to request them.",
      ].join("\n"),
    });

    if (existing) {
      await db
        .update(contextRepos)
        .set({ openPrUrl: pr.url, updatedAt: new Date() })
        .where(eq(contextRepos.id, existing.id));
    } else {
      await db.insert(contextRepos).values({
        eventId,
        githubRepoUrl: repo.url,
        defaultBranch: repo.defaultBranch,
        isPublic: false,
        openPrUrl: pr.url,
      });
    }

    await setStatus(eventId, "repo_review", "repo_generating", actor, {
      repoUrl: repo.url,
      pullRequestUrl: pr.url,
      fileCount: Object.keys(files).length,
    });

    return {
      ok: true,
      repoUrl: repo.url,
      pullRequestUrl: pr.url,
      fileCount: Object.keys(files).length,
      updated: Boolean(existing),
    };
  } catch (err) {
    // Put the event back where it was — `repo_generating` with no repo is a
    // dead end nobody can act on.
    await setStatus(eventId, previousStatus, "repo_generating", actor, {
      failed: true,
    }).catch((restoreErr) =>
      console.error("[repo] failed to restore event status", restoreErr),
    );
    const message = err instanceof Error ? err.message : String(err);
    console.error("[repo] provisioning failed", err);
    return { ok: false, reason: `Couldn't build the repository: ${message}` };
  }
}

function scanFiles(files: RepoFiles): string | null {
  for (const [filePath, content] of Object.entries(files)) {
    const findings = findSecrets(content);
    if (findings.length > 0) {
      return `${describeSecretFindings(findings)} (in ${filePath}) Nothing was pushed.`;
    }
  }
  return null;
}

/** `org/repo` from a stored URL; falls back to the event slug for local refs. */
function fullNameFromUrl(url: string, eventSlug: string): string {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (match) return match[1];
  const org = process.env.RR_GITHUB_ORG ?? "white-rabbit-local";
  return `${org}/${repoNameForEvent(eventSlug)}`;
}

async function setStatus(
  eventId: string,
  next: string,
  from: string,
  actor: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({ status: next as "repo_review", updatedAt: new Date() })
      .where(and(eq(events.id, eventId)));
    await tx.insert(auditLog).values({
      eventId,
      actor,
      action: `event.${next}`,
      entity: "event",
      fromValue: from,
      toValue: next,
      metadata: { eventId, ...metadata },
    });
  });
}

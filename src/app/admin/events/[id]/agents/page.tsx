import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AGENT_CATALOG, AGENT_TYPES } from "@/lib/rogue-raise/agents/catalog";
import { registerAgentHandlers } from "@/lib/rogue-raise/agents/handlers";
import { hasAgentHandler } from "@/lib/rogue-raise/agents/registry";
import {
  listAgentRuns,
  listAssetGroups,
} from "@/lib/rogue-raise/agents/queries";
import { totalCostForEvent } from "@/lib/rogue-raise/agents/runs";
import { loadAdminEvent } from "@/lib/rogue-raise/events/queries";
import { eventStatusLabel } from "@/lib/rogue-raise/events/status";
import { loadContextRepo } from "@/lib/rogue-raise/repo/queries";
import {
  canProvisionRepo,
  describeProvisioningBlockers,
} from "@/lib/rogue-raise/repo/provision";
import { cn } from "@/lib/utils";

import { AgentRunner } from "./agent-runner";
import { RepoCard } from "./repo-card";

export const metadata = { title: "Agents · Rogue Raise" };
export const dynamic = "force-dynamic";

// So the page can tell "not built yet" from "wrong phase" — the two read very
// differently to a staff member deciding whether to wait or to ask us.
registerAgentHandlers();

const REVIEW_GATE_LABELS: Record<string, string> = {
  admin: "WR Admin approves",
  admin_and_stakeholders: "WR Admin + stakeholders approve",
  admin_and_sponsor: "WR Admin + sponsor approve",
  auto: "No review — internal statistics",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  edit_requested: "Edits requested",
  rejected: "Rejected",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  paused_for_review: "Paused for review",
  succeeded: "Succeeded",
  failed: "Failed",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function assetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default async function AdminEventAgentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const event = await loadAdminEvent(id);
  if (!event) notFound();

  const [runs, assetGroups, costTokens, contextRepo, blockers] = await Promise.all([
    listAgentRuns(id),
    listAssetGroups(id),
    totalCostForEvent(id),
    loadContextRepo(id),
    describeProvisioningBlockers(id),
  ]);

  const runsByType = new Map<string, typeof runs>();
  for (const run of runs) {
    const list = runsByType.get(run.type) ?? [];
    list.push(run);
    runsByType.set(run.type, list);
  }

  /** A reviewer's most recent "please change this" note, per agent. */
  const editRequestFor = (assetTypes: readonly string[]): string | null => {
    for (const group of assetGroups) {
      if (!assetTypes.includes(group.type)) continue;
      if (group.latest.reviewStatus === "edit_requested" && group.latest.reviewNote) {
        return group.latest.reviewNote;
      }
    }
    return null;
  };

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-10 px-6 py-16">
      <div>
        <Link
          href={`/admin/events/${id}`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          ← {event.organizationName}
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">Agents</h1>
        <p className="max-w-prose text-ink/80">
          Agents draft; people decide. Nothing here reaches a participant until
          someone approves it.
        </p>
        <p className="text-sm text-ink/60">
          Event status: {eventStatusLabel(event.status)} · {runs.length} run(s) ·{" "}
          {costTokens.toLocaleString()} tokens spent so far.
        </p>
      </header>

      {/* --- Drafts awaiting a decision --- */}
      <section aria-labelledby="drafts" className="flex flex-col gap-4">
        <h2 id="drafts" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Drafts
        </h2>
        {assetGroups.length === 0 ? (
          <p className="text-ink/70">
            Nothing drafted yet. Run an agent below to produce the first documents.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {assetGroups.map((group) => (
              <li
                key={group.type}
                className="rounded-lg border border-wr-olive-green/25 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/admin/events/${id}/assets/${group.latest.id}`}
                      className="font-serif text-lg font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      {group.latest.title ?? assetTypeLabel(group.type)}
                    </Link>
                    <p className="mt-1 text-sm text-ink/70">
                      Version {group.latest.version}
                      {group.olderVersions.length > 0
                        ? ` · ${group.olderVersions.length} earlier version(s)`
                        : ""}
                      {group.latest.agentRunId === null ? " · edited by a person" : ""}
                    </p>
                    {group.latest.reviewNote ? (
                      <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-ink/70">
                        “{group.latest.reviewNote}”
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-0.5 font-mono text-xs uppercase tracking-wide",
                      group.latest.reviewStatus === "approved"
                        ? "bg-primary text-primary-foreground"
                        : group.latest.reviewStatus === "rejected"
                          ? "bg-destructive text-white"
                          : "border border-wr-olive-green/50 text-ink/80",
                    )}
                  >
                    {REVIEW_STATUS_LABELS[group.latest.reviewStatus] ??
                      group.latest.reviewStatus}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RepoCard
        eventId={id}
        blockers={blockers}
        repoUrl={contextRepo?.githubRepoUrl ?? null}
        pullRequestUrl={contextRepo?.openPrUrl ?? null}
        isPublic={contextRepo?.isPublic ?? false}
        canProvision={canProvisionRepo(event.status)}
        phaseReason={
          canProvisionRepo(event.status)
            ? null
            : `The repo is built once the intake is complete and the documents are approved. This event is ${eventStatusLabel(event.status)}.`
        }
      />

      {/* --- The catalog --- */}
      <section aria-labelledby="catalog" className="flex flex-col gap-4">
        <h2 id="catalog" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Available agents
        </h2>

        <ul className="flex flex-col gap-4">
          {AGENT_TYPES.map((type) => {
            const definition = AGENT_CATALOG[type];
            const agentRuns = runsByType.get(type) ?? [];
            const implemented = hasAgentHandler(type);
            const canRun = implemented && definition.triggerStatuses.includes(event.status);
            const latestRun = agentRuns[0] ?? null;

            return (
              <li
                key={type}
                className="flex flex-col gap-3 rounded-lg border border-wr-olive-green/25 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-lg font-semibold text-ink">
                      {definition.label}
                    </h3>
                    <p className="mt-1 max-w-prose text-sm text-ink/70">
                      {definition.description}
                    </p>
                  </div>
                  <span className="rounded-full border border-wr-olive-green/50 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink/80">
                    Phase {definition.phase}
                  </span>
                </div>

                <p className="text-sm text-ink/60">
                  {REVIEW_GATE_LABELS[definition.reviewGate]}
                  {definition.reviewGate === "admin_and_stakeholders" ? (
                    <>
                      {" "}
                      — <strong className="text-ink/80">
                        the stakeholder half isn&rsquo;t built yet
                      </strong>
                      ; approving here is WR Admin only.
                    </>
                  ) : null}
                </p>

                <AgentRunner
                  eventId={id}
                  agentType={type}
                  agentLabel={definition.label}
                  canRun={canRun}
                  blockedReason={
                    canRun
                      ? null
                      : !implemented
                        ? "Not built yet — this agent lands in a later milestone."
                        : `Runs during: ${definition.triggerStatuses
                            .map(eventStatusLabel)
                            .join(", ")}. This event is ${eventStatusLabel(event.status)}.`
                  }
                  hasRun={agentRuns.length > 0}
                  latestRunId={latestRun?.id ?? null}
                  suggestedInstructions={editRequestFor(definition.assetTypes)}
                />

                {agentRuns.length > 0 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-ink/70">
                      {agentRuns.length} run(s)
                    </summary>
                    <ul className="mt-2 flex flex-col gap-3">
                      {agentRuns.map((run) => (
                        <li
                          key={run.id}
                          className="border-l-2 border-wr-olive-green/30 pl-3"
                        >
                          <p className="text-ink/90">
                            {RUN_STATUS_LABELS[run.status] ?? run.status} ·{" "}
                            {formatWhen(run.startedAt)} ·{" "}
                            {run.costTokens.toLocaleString()} tokens
                            {run.parentRunId ? " · re-run" : ""}
                          </p>
                          {run.additionalInstructions ? (
                            <p className="mt-1 whitespace-pre-wrap text-ink/70">
                              Instructions: {run.additionalInstructions}
                            </p>
                          ) : null}
                          {run.error ? (
                            <p className="mt-1 text-destructive">{run.error}</p>
                          ) : null}
                          {run.logs ? (
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink/60">
                              {run.logs}
                            </pre>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
